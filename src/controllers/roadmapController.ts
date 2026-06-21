import { Response } from 'express';
import { prisma } from '../lib/prisma';
import { AIService } from '../services/aiService';
import { PDFGenerator } from '../utils/pdfGenerator';
import { DOCXGenerator } from '../utils/docxGenerator';
import http from 'http';
import https from 'https';

const aiService = new AIService();

const isUrlLive = async (urlStr: string): Promise<boolean> => {
  try {
    const url = new URL(urlStr);
    return new Promise((resolve) => {
      const client = url.protocol === 'https:' ? https : http;
      const req = client.request(urlStr, { method: 'GET', timeout: 5000 }, (res) => {
        resolve(true); // Any response means the server is alive and reachable!
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });
  } catch {
    return false;
  }
};

export const generateRoadmap = async (req: any, res: Response): Promise<void> => {
  try {
    const { durationDays, jobProfileId, careerGoal } = req.body;
    const userId = req.user.id;

    if (!durationDays) {
      res.status(400).json({ error: 'Duration Days parameter is required.' });
      return;
    }

    const duration = parseInt(durationDays, 10);
    if (![7, 14, 21, 30, 60, 90].includes(duration)) {
      res.status(400).json({ error: 'Roadmap duration must be exactly 7, 14, 21, 30, 60, or 90 days.' });
      return;
    }

    let jobProfile = null;
    if (jobProfileId) {
      jobProfile = await prisma.jobProfile.findUnique({
        where: { id: jobProfileId }
      });
      if (jobProfile && jobProfile.userId !== userId) {
        res.status(403).json({ error: 'Unauthorized to access this job profile.' });
        return;
      }
    }

    // Fetch latest active ATSReport to extract resumeText
    const latestAts = await prisma.aTSReport.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });

    if (!jobProfile) {
      if (latestAts && latestAts.jobProfileId) {
        jobProfile = await prisma.jobProfile.findUnique({
          where: { id: latestAts.jobProfileId }
        });
      }
    }

    if (!jobProfile) {
      res.status(400).json({ error: 'No active job profile found. Please upload a resume first.' });
      return;
    }

    const resumeText = latestAts ? latestAts.resumeText : '';

    // Extract skills list from the job profile missing skills
    const missingSkillsObj = JSON.parse(jobProfile.missingSkills);
    const skillsToLearn = Array.isArray(missingSkillsObj)
      ? missingSkillsObj.map((s: any) => typeof s === 'string' ? s : (s.skill || ''))
      : [];

    // Call AI to generate timeline items with telemetry log
    const aiStartTime = Date.now();
    let aiStatus = 'SUCCESS';
    let aiError: string | null = null;
    let roadmapData;
    try {
      roadmapData = await aiService.generateRoadmap(
        jobProfile.jobTitle,
        skillsToLearn,
        duration,
        jobProfile.experienceLevel,
        careerGoal || '',
        resumeText || ''
      );
    } catch (err: any) {
      aiStatus = 'FAILED';
      aiError = err.message;
      throw err;
    } finally {
      const responseTimeMs = Date.now() - aiStartTime;
      await prisma.aiRequestLog.create({
        data: {
          requestType: 'ROADMAP',
          responseTimeMs,
          status: aiStatus,
          errorMessage: aiError
        }
      });
    }

    // Save to Database
    const roadmap = await prisma.roadmap.create({
      data: {
        userId,
        jobProfileId: jobProfile.id,
        title: roadmapData.title,
        durationDays: duration,
        structure: JSON.stringify({
          weeks: roadmapData.structure,
          resources: []
        })
      }
    });

    // Log Activity
    await prisma.activityLog.create({
      data: {
        userId,
        action: 'ROADMAP_GENERATION',
        details: `Generated ${duration}-day roadmap for ${jobProfile.jobTitle} (Domain: ${jobProfile.domainClassification})`
      }
    });

    res.status(200).json({
      message: 'Roadmap generated successfully.',
      roadmap
    });
  } catch (error: any) {
    console.error('Roadmap Controller Error:', error);
    res.status(500).json({ error: error.message || 'An error occurred during roadmap generation.' });
  }
};

export const getRoadmaps = async (req: any, res: Response): Promise<void> => {
  try {
    const userId = req.user.id;

    const roadmaps = await prisma.roadmap.findMany({
      where: { userId },
      include: { jobProfile: true },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json({ roadmaps });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to retrieve roadmaps.' });
  }
};

export const getRoadmapById = async (req: any, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const roadmap = await prisma.roadmap.findFirst({
      where: { id, userId }
    });

    if (!roadmap) {
      res.status(404).json({ error: 'Roadmap not found.' });
      return;
    }

    res.status(200).json({ roadmap });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to retrieve roadmap details.' });
  }
};

export const deleteRoadmap = async (req: any, res: Response): Promise<void> => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const roadmap = await prisma.roadmap.findUnique({
      where: { id }
    });

    if (!roadmap) {
      res.status(404).json({ error: 'Roadmap not found.' });
      return;
    }

    if (roadmap.userId !== userId) {
      res.status(403).json({ error: 'Unauthorized to delete this record.' });
      return;
    }

    await prisma.roadmap.delete({
      where: { id }
    });

    res.status(200).json({ message: 'Roadmap deleted successfully.' });
  } catch (error: any) {
    console.error('Delete roadmap error:', error);
    res.status(500).json({ error: 'Failed to delete roadmap.' });
  }
};

export const bulkDeleteRoadmaps = async (req: any, res: Response): Promise<void> => {
  try {
    const userId = req.user.id;
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids)) {
      res.status(400).json({ error: 'IDs array is required.' });
      return;
    }

    const deleted = await prisma.roadmap.deleteMany({
      where: {
        id: { in: ids },
        userId
      }
    });

    res.status(200).json({ message: 'Selected roadmaps deleted successfully.', count: deleted.count });
  } catch (error: any) {
    console.error('Bulk delete roadmaps error:', error);
    res.status(500).json({ error: 'Failed to delete selected roadmaps.' });
  }
};

export const toggleRoadmapStatus = async (req: any, res: Response): Promise<void> => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const roadmap = await prisma.roadmap.findUnique({
      where: { id }
    });

    if (!roadmap) {
      res.status(404).json({ error: 'Roadmap not found.' });
      return;
    }

    if (roadmap.userId !== userId) {
      res.status(403).json({ error: 'Unauthorized to modify this record.' });
      return;
    }

    // Toggle active status
    const newStatus = roadmap.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const updatedRoadmap = await prisma.roadmap.update({
      where: { id },
      data: {
        status: newStatus,
        is_active: newStatus === 'ACTIVE'
      }
    });

    res.status(200).json({
      message: `Roadmap set to ${updatedRoadmap.status} successfully.`,
      roadmap: updatedRoadmap
    });
  } catch (error: any) {
    console.error('Toggle roadmap status error:', error);
    res.status(500).json({ error: 'Failed to toggle roadmap status.' });
  }
};

export const updateRoadmapStatus = async (req: any, res: Response): Promise<void> => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { status } = req.body; // ACTIVE, INACTIVE, ARCHIVED

    if (!status || !['ACTIVE', 'INACTIVE', 'ARCHIVED', 'COMPLETED'].includes(status)) {
      res.status(400).json({ error: 'Valid status parameter is required.' });
      return;
    }

    const roadmap = await prisma.roadmap.findUnique({
      where: { id }
    });

    if (!roadmap) {
      res.status(404).json({ error: 'Roadmap not found.' });
      return;
    }

    if (roadmap.userId !== userId) {
      res.status(403).json({ error: 'Unauthorized to modify this record.' });
      return;
    }

    const updatedRoadmap = await prisma.roadmap.update({
      where: { id },
      data: {
        status,
        is_active: status === 'ACTIVE'
      }
    });

    res.status(200).json({
      message: `Roadmap status updated to ${status} successfully.`,
      roadmap: updatedRoadmap
    });
  } catch (error: any) {
    console.error('Update roadmap status error:', error);
    res.status(500).json({ error: 'Failed to update roadmap status.' });
  }
};

export const updateRoadmapProgress = async (req: any, res: Response): Promise<void> => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const {
      checkedItems,
      timeSpentLearning, // additional hours spent in this update
      currentWeek,
      certificationsEarned,
      courseProgress
    } = req.body;

    const roadmap = await prisma.roadmap.findUnique({
      where: { id }
    });

    if (!roadmap) {
      res.status(404).json({ error: 'Roadmap not found.' });
      return;
    }

    if (roadmap.userId !== userId) {
      res.status(403).json({ error: 'Unauthorized to modify this record.' });
      return;
    }

    if (roadmap.status === 'ARCHIVED') {
      res.status(400).json({ error: 'Archived roadmaps are read-only and cannot receive progress updates.' });
      return;
    }

    // Helper to calculate checklist stats (total checkable tasks and checked count)
    const getRoadmapChecklistStats = (roadmapId: string, structureStr: string, checkedItemsArr: string[]) => {
      try {
        const structure = JSON.parse(structureStr);
        const weeks = Array.isArray(structure) ? structure : (structure.weeks || []);
        const checkableKeys = new Set<string>();
        
        for (const week of weeks) {
          const w = week.week;
          
          // 1. Practice & Coding Tasks (Practice Coding & Logic Tasks / Theory Tasks)
          if (Array.isArray(week.practiceTasks)) {
            week.practiceTasks.forEach((_: any, idx: number) => {
              checkableKeys.add(`${roadmapId}_w${w}_pt_${idx}`);
            });
          }
          
          // 2. Mini Project
          if (week.miniProject && week.miniProject.title) {
            checkableKeys.add(`${roadmapId}_w${w}_project`);
          }
          
          // 3. Credentials (Courses & Certifications)
          if (Array.isArray(week.courses)) {
            week.courses.forEach((_: any, idx: number) => {
              checkableKeys.add(`${roadmapId}_w${w}_course_${idx}`);
            });
          }
          if (Array.isArray(week.certifications)) {
            week.certifications.forEach((_: any, idx: number) => {
              checkableKeys.add(`${roadmapId}_w${w}_cert_${idx}`);
            });
          }
          
          // 4. Interview Prep Questions
          if (week.interviewPrep) {
            const categories = [
              'technicalQuestions',
              'codingQuestions',
              'scenarioQuestions',
              'companySpecificQuestions',
              'hrQuestions'
            ];
            categories.forEach((catKey) => {
              const list = week.interviewPrep[catKey];
              if (Array.isArray(list)) {
                list.forEach((_: any, idx: number) => {
                  checkableKeys.add(`${roadmapId}_w${w}_interview_${catKey}_${idx}`);
                });
              }
            });
          }
        }
        
        const total = checkableKeys.size;
        let checked = 0;
        for (const item of checkedItemsArr) {
          if (checkableKeys.has(item)) {
            checked++;
          }
        }
        return { total, checked };
      } catch {
        return { total: 0, checked: 0 };
      }
    };

    const checkedItemsArr = Array.isArray(checkedItems) ? checkedItems : [];
    const { total: totalTasks, checked: checkedCount } = getRoadmapChecklistStats(id, roadmap.structure, checkedItemsArr);
    const progress_percentage = totalTasks > 0 ? parseFloat(((checkedCount / totalTasks) * 100).toFixed(1)) : 0.0;

    let status = roadmap.status;
    let completedAt = roadmap.completedAt;
    let finalAssessment = roadmap.finalAssessment;
    let completionRecommendations = roadmap.completionRecommendations;

    // Detect if progress is 100% and auto-complete
    if (progress_percentage >= 100.0 && roadmap.status !== 'COMPLETED') {
      status = 'COMPLETED';
      completedAt = new Date();

      // Generate AI completion details
      const totalHours = (roadmap.timeSpentLearning || 0) + (timeSpentLearning || 0);
      try {
        const insights = await aiService.generateRoadmapCompletionInsights(
          roadmap.title,
          roadmap.durationDays,
          totalHours,
          checkedCount
        );
        finalAssessment = insights.finalAssessment;
        completionRecommendations = JSON.stringify(insights.nextRecommendations);
      } catch (err) {
        console.error('Failed to generate roadmap completion insights:', err);
      }
    } else if (progress_percentage < 100.0 && roadmap.status === 'COMPLETED') {
      // If user unchecked tasks, move back to ACTIVE
      status = 'ACTIVE';
      completedAt = null;
      finalAssessment = null;
      completionRecommendations = null;
    }

    const updatedRoadmap = await prisma.roadmap.update({
      where: { id },
      data: {
        progress_percentage,
        current_week: currentWeek || roadmap.current_week,
        completedTasks: checkedItems ? JSON.stringify(checkedItems) : roadmap.completedTasks,
        timeSpentLearning: timeSpentLearning !== undefined 
          ? (roadmap.timeSpentLearning || 0) + timeSpentLearning
          : roadmap.timeSpentLearning,
        certificationsEarned: certificationsEarned ? JSON.stringify(certificationsEarned) : roadmap.certificationsEarned,
        courseProgress: courseProgress ? JSON.stringify(courseProgress) : roadmap.courseProgress,
        status,
        completedAt,
        finalAssessment,
        completionRecommendations
      }
    });

    res.status(200).json({
      message: 'Roadmap progress updated successfully.',
      roadmap: updatedRoadmap
    });
  } catch (error: any) {
    console.error('Update roadmap progress error:', error);
    res.status(500).json({ error: 'Failed to update roadmap progress.' });
  }
};


export const downloadRoadmap = async (req: any, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { format } = req.query;
    const userId = req.user.id;

    const roadmap = await prisma.roadmap.findFirst({
      where: { id, userId }
    });

    if (!roadmap) {
      res.status(404).json({ error: 'Roadmap not found.' });
      return;
    }

    if (format === 'pdf') {
      const pdfBuffer = await PDFGenerator.generateRoadmapPDF(roadmap);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=roadmap_${id}.pdf`);
      res.status(200).send(pdfBuffer);
      return;
    } else if (format === 'docx') {
      const docxBuffer = await DOCXGenerator.generateRoadmapDocx(roadmap);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename=roadmap_${id}.docx`);
      res.status(200).send(docxBuffer);
      return;
    } else if (format === 'markdown') {
      const structure = JSON.parse(roadmap.structure);
      const weeks = Array.isArray(structure) ? structure : (structure.weeks || []);

      let mdText = `# ${roadmap.title}\n\n`;
      mdText += `**Duration:** ${roadmap.durationDays} Days\n\n`;

      for (const week of weeks) {
        mdText += `## ${week.title || `Week ${week.week}`}\n`;
        if (week.weekGoal) mdText += `*Goal: ${week.weekGoal}*\n\n`;
        
        const topicNames = week.topics ? week.topics.map((t: any) => typeof t === 'string' ? t : (t.name || '')).filter(Boolean) : [];
        if (topicNames.length > 0) {
          mdText += `### Topics to Learn\n`;
          mdText += `${topicNames.map((t: string) => `* ${t}`).join('\n')}\n\n`;
        }

        if (week.courses && week.courses.length > 0) {
          mdText += `### Learning Resources\n\n`;
          for (const course of week.courses) {
            if (course.topic) {
              mdText += `**${course.topic}**\n`;
            }
            mdText += `Course: ${course.name}\n`;
            mdText += `Platform: ${course.platform}\n`;
            if (course.link) {
              mdText += `Link: ${course.link}\n`;
            }
            mdText += `\n`;
          }
        }

        if (week.practiceTasks && week.practiceTasks.length > 0) {
          mdText += `### Practice Tasks\n`;
          for (const task of week.practiceTasks) {
            const taskTitle = typeof task === 'string' ? task : (task.title || `Task`);
            mdText += `* ${taskTitle}\n`;
          }
          mdText += `\n`;
        }

        if (week.certifications && week.certifications.length > 0) {
          mdText += `### Certifications\n\n`;
          for (const cert of week.certifications) {
            const certName = typeof cert === 'string' ? cert : cert.name;
            const certLink = typeof cert === 'string' || !cert.link ? '' : cert.link;
            mdText += `${certName}\n`;
            if (certLink) {
              mdText += `Link: ${certLink}\n`;
            }
            mdText += `\n`;
          }
        }

        mdText += `---\n\n`;
      }

      res.setHeader('Content-Type', 'text/markdown');
      res.setHeader('Content-Disposition', `attachment; filename=roadmap_${id}.md`);
      res.status(200).send(mdText);
      return;
    } else {
      res.status(400).json({ error: 'Invalid download format requested. Use pdf, docx, or markdown.' });
    }
  } catch (error: any) {
    console.error('Download Roadmap Error:', error);
    res.status(500).json({ error: error.message || 'Failed to export roadmap.' });
  }
};

export const getTopicExplanation = async (req: any, res: Response): Promise<void> => {
  try {
    const { id, topicName } = req.params;
    const userId = req.user.id;

    const roadmap = await prisma.roadmap.findFirst({
      where: { id, userId },
      include: { jobProfile: true }
    });

    if (!roadmap) {
      res.status(404).json({ error: 'Roadmap not found.' });
      return;
    }

    const explanation = await aiService.generateTopicContent(topicName, roadmap.jobProfile?.jobTitle || 'Software Engineer');
    res.status(200).json({ explanation });
  } catch (error: any) {
    console.error('getTopicExplanation error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch topic explanation.' });
  }
};

export const submitProject = async (req: any, res: Response): Promise<void> => {
  try {
    const { id, week } = req.params;
    const { githubUrl, deploymentUrl } = req.body;
    const userId = req.user.id;

    if (!githubUrl || !deploymentUrl) {
      res.status(400).json({ error: 'Both GitHub URL and Deployment URL are required.' });
      return;
    }

    // Verify URLs are accessible and live
    const [githubLive, deploymentLive] = await Promise.all([
      isUrlLive(githubUrl),
      isUrlLive(deploymentUrl)
    ]);

    if (!githubLive) {
      res.status(400).json({ error: 'GitHub URL is not reachable or invalid.' });
      return;
    }
    if (!deploymentLive) {
      res.status(400).json({ error: 'Deployment URL is not reachable or invalid.' });
      return;
    }

    const roadmap = await prisma.roadmap.findFirst({
      where: { id, userId },
      include: { jobProfile: true }
    });

    if (!roadmap) {
      res.status(404).json({ error: 'Roadmap not found.' });
      return;
    }

    // Parse weeks to find the project details for this week
    const structure = JSON.parse(roadmap.structure);
    const weeks = Array.isArray(structure) ? structure : (structure.weeks || []);
    const weekNum = parseInt(week, 10);
    const targetWeek = weeks.find((w: any) => w.week === weekNum);

    if (!targetWeek || !targetWeek.miniProject) {
      res.status(404).json({ error: 'Mini-project not found for this week.' });
      return;
    }

    const evaluation = await aiService.evaluateProject(
      targetWeek.miniProject.title,
      targetWeek.miniProject.description,
      githubUrl,
      roadmap.jobProfile?.jobTitle || 'Software Engineer'
    );

    // Retrieve existing submissions
    let submissions: Record<string, any> = {};
    if (roadmap.projectSubmissions) {
      try {
        submissions = JSON.parse(roadmap.projectSubmissions);
      } catch {
        submissions = {};
      }
    }

    // Update submission for this week
    submissions[week] = {
      githubUrl,
      deploymentUrl,
      evaluation,
      submittedAt: new Date().toISOString()
    };

    await prisma.roadmap.update({
      where: { id },
      data: {
        projectSubmissions: JSON.stringify(submissions)
      }
    });

    res.status(200).json({
      message: 'Project submitted and evaluated successfully.',
      submission: submissions[week]
    });
  } catch (error: any) {
    console.error('submitProject error:', error);
    res.status(500).json({ error: error.message || 'Failed to submit project.' });
  }
};

export const addProjectToResume = async (req: any, res: Response): Promise<void> => {
  try {
    const { id, week } = req.params;
    const userId = req.user.id;

    const roadmap = await prisma.roadmap.findFirst({
      where: { id, userId }
    });

    if (!roadmap) {
      res.status(404).json({ error: 'Roadmap not found.' });
      return;
    }

    // Retrieve submission evaluation for this week
    if (!roadmap.projectSubmissions) {
      res.status(400).json({ error: 'No project submission found to add to resume.' });
      return;
    }

    const submissions = JSON.parse(roadmap.projectSubmissions);
    const submission = submissions[week];
    if (!submission || !submission.evaluation || !submission.evaluation.resumeEntry) {
      res.status(400).json({ error: 'No evaluation or resume entry found for this week.' });
      return;
    }

    const { title, technologies, bullets } = submission.evaluation.resumeEntry;

    // Format the project string
    const projectBlock = `\n\n${title} | Technologies: ${technologies}\n` + 
      bullets.map((b: string) => `- ${b}`).join('\n') + '\n';

    // Fetch the latest ATSReport for this user
    const latestAts = await prisma.aTSReport.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });

    if (!latestAts) {
      res.status(400).json({ error: 'No active ATS Report found to update.' });
      return;
    }

    let updatedResumeText = latestAts.resumeText || '';

    // Case-insensitive search for [Projects] or Projects section
    const projectsHeaderRegex = /(?:^|\n)(?:\[Projects\]|Projects:?)(?:\r?\n|$)/i;
    const match = updatedResumeText.match(projectsHeaderRegex);

    if (match && match.index !== undefined) {
      // Insert right after the [Projects] header
      const insertIndex = match.index + match[0].length;
      updatedResumeText = 
        updatedResumeText.slice(0, insertIndex) + 
        projectBlock.trim() + '\n\n' + 
        updatedResumeText.slice(insertIndex);
    } else {
      // Append [Projects] section at the bottom
      updatedResumeText = updatedResumeText.trim() + `\n\n[Projects]\n` + projectBlock.trim() + '\n';
    }

    // Update ATSReport in database
    await prisma.aTSReport.update({
      where: { id: latestAts.id },
      data: {
        resumeText: updatedResumeText
      }
    });

    // Set addedToResume flag on the submission and update the roadmap in DB
    submissions[week].addedToResume = true;
    await prisma.roadmap.update({
      where: { id },
      data: {
        projectSubmissions: JSON.stringify(submissions)
      }
    });

    // Log Activity
    await prisma.activityLog.create({
      data: {
        userId,
        action: 'RESUME_PROJECT_ADDITION',
        details: `Added project "${title}" to resume after roadmap evaluation`
      }
    });

    res.status(200).json({
      message: 'Project added to resume successfully.',
      updatedResumeText
    });
  } catch (error: any) {
    console.error('addProjectToResume error:', error);
    res.status(500).json({ error: error.message || 'Failed to add project to resume.' });
  }
};
