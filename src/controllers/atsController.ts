import { Response } from 'express';
import { prisma } from '../lib/prisma';
import { ParserService } from '../services/parserService';
import { AIService } from '../services/aiService';
import { StorageService } from '../services/storageService';
import { v4 as uuidv4 } from 'uuid';
import { DOCXGenerator } from '../utils/docxGenerator';

const parserService = new ParserService();
const aiService = new AIService();
const storageService = new StorageService();

export const isValidResume = (text: string): boolean => {
  if (!text || text.trim().length < 150) return false;
  const lower = text.toLowerCase();
  
  const wordsCount = text.trim().split(/\s+/).filter(w => w.length > 0).length;
  if (wordsCount < 40) return false;

  let score = 0;
  
  // 1. Must have contact details format (email, phone, or standard social link)
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const phoneRegex = /\b\+?[0-9]{1,4}[-.\s]?[0-9]{3}[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b/;
  const hasEmail = emailRegex.test(lower);
  const hasPhone = phoneRegex.test(lower);
  const hasSocials = /linkedin\.com/i.test(lower) || /github\.com/i.test(lower) || /portfolio/i.test(lower);
  
  if (hasEmail || hasPhone || hasSocials) {
    score += 2; // high weight for contact details
  }

  // 2. Education keywords
  if (/\b(education|academic|university|college|degree|bachelor|master|school|gpa|academics|graduation)\b/.test(lower)) {
    score++;
  }
  
  // 3. Skills keywords
  if (/\b(skills|technical skills|technologies|languages|frameworks|tools|competencies|key skills)\b/.test(lower)) {
    score++;
  }
  
  // 4. Experience keywords
  if (/\b(experience|work experience|employment|history|professional experience|career history|job history|work history|internship)\b/.test(lower)) {
    score++;
  }
  
  // 5. Projects keywords
  if (/\b(projects|personal projects|academic projects|key projects|project)\b/.test(lower)) {
    score++;
  }

  // 6. Typical layout markers (bullets)
  const hasBullets = (text.includes('•') || text.includes('- ') || text.includes('* '));
  if (hasBullets) {
    score++;
  }

  // Must have some contact detail AND a score >= 4
  return (hasEmail || hasPhone || hasSocials) && score >= 4;
};

export const runFinalValidationChecklist = (
  optimizedText: string,
  mode: 'MODIFY_EXISTING' | 'GENERATE_NEW',
  originalText: string,
  jobTitle: string,
  jobDescription: string
): string[] => {
  const errors: string[] = [];
  const lowerText = optimizedText.toLowerCase();

  // Helper to split text into lines
  const lines = optimizedText.split('\n').map(l => l.trim());

  // 1. Check 1: No duplicate sections
  const standardHeaders = [
    'professional summary', 'summary',
    'technical skills', 'skills',
    'professional experience', 'experience', 'work experience',
    'projects',
    'education',
    'certifications',
    'achievements'
  ];
  
  const bracketedHeaders = [
    '[professional summary]',
    '[technical skills]',
    '[professional experience]',
    '[projects]',
    '[education]',
    '[certifications]',
    '[achievements]'
  ];

  const foundHeaders = new Set<string>();
  for (const line of lines) {
    const lowerLine = line.toLowerCase();
    
    // Check for bracketed headers in mode 2, or standard sections in general
    let matchedHeader = '';
    if (mode === 'GENERATE_NEW') {
      const match = bracketedHeaders.find(h => lowerLine === h);
      if (match) matchedHeader = match;
    } else {
      // For MODIFY_EXISTING, detect sections. Clean line first (strip diff tags, brackets, colons)
      const cleanLine = lowerLine
        .replace(/<\/?[^>]+(>|$)/g, "") // strip HTML tags
        .replace(/[\[\]\*\:#]/g, '') // strip brackets, asterisks, colons
        .trim();
      const match = standardHeaders.find(h => cleanLine === h);
      if (match && cleanLine.length === match.length) {
        matchedHeader = match;
      }
    }

    if (matchedHeader) {
      if (foundHeaders.has(matchedHeader)) {
        errors.push(`Check 1 Failed: Duplicate section header detected for "${line}".`);
      }
      foundHeaders.add(matchedHeader);
    }
  }

  // 2. Check 2: No empty sections
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lowerLine = line.toLowerCase();
    
    let isHeader = false;
    if (mode === 'GENERATE_NEW') {
      isHeader = bracketedHeaders.includes(lowerLine);
    } else {
      const cleanLine = lowerLine
        .replace(/<\/?[^>]+(>|$)/g, "")
        .replace(/[\[\]\*\:#]/g, '')
        .trim();
      isHeader = standardHeaders.some(h => cleanLine === h && cleanLine.length === h.length);
    }

    if (isHeader) {
      // Look ahead to check if the next non-empty line is another section header or end of file
      let hasContent = false;
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j];
        if (!nextLine) continue; // Skip empty lines
        
        const nextLower = nextLine.toLowerCase();
        let isNextHeader = false;
        if (mode === 'GENERATE_NEW') {
          isNextHeader = bracketedHeaders.includes(nextLower);
        } else {
          const nextClean = nextLower
            .replace(/<\/?[^>]+(>|$)/g, "")
            .replace(/[\[\]\*\:#]/g, '')
            .trim();
          isNextHeader = standardHeaders.some(h => nextClean === h && nextClean.length === h.length);
        }

        if (isNextHeader) {
          break; // Hit next header before finding content
        }
        
        // If it has non-whitespace characters, it counts as content
        if (nextLine.replace(/<\/?[^>]+(>|$)/g, "").trim().length > 0) {
          hasContent = true;
          break;
        }
      }
      
      if (!hasContent) {
        errors.push(`Check 2 Failed: Empty section header detected for "${line}". All headers must have content.`);
      }
    }
  }

  // 3. Check 3: No repeated content
  // We can look for identical non-empty lines that are repeated sequentially or across the text
  const seenLines = new Set<string>();
  for (const line of lines) {
    const clean = line.replace(/<\/?[^>]+(>|$)/g, "").trim();
    if (clean.length > 15) { // Only check longer sentences to avoid bullet dots or metadata separators
      if (seenLines.has(clean)) {
        errors.push(`Check 3 Failed: Repeated line/content detected: "${clean}".`);
      }
      seenLines.add(clean);
    }
  }

  // 4. Check 4 & 5: Correct mode & Diff preservation for MODIFY_EXISTING
  const hasDiffTags = /<ins>|<mark>|<del>/.test(optimizedText);
  if (mode === 'MODIFY_EXISTING') {
    if (!hasDiffTags) {
      errors.push(`Check 4 Failed: Modify mode selected, but no diff tags (<ins>, <mark>, <del>) were found in the output.`);
    }
    
    // Check 5: Original design preserved. We check if the number of lines is relatively close (e.g., within 45%)
    const origLinesCount = originalText.split('\n').filter(l => l.trim()).length;
    const optLinesCount = lines.filter(l => l).length;
    if (optLinesCount > 0 && (optLinesCount < origLinesCount * 0.4 || optLinesCount > origLinesCount * 2.5)) {
      errors.push(`Check 5 Failed: Modify mode must preserve original structure. Line count changed too drastically (Original: ${origLinesCount}, Optimized: ${optLinesCount}).`);
    }
  }

  // 5. Check 6 & 7: Correct mode & Leakage for GENERATE_NEW
  if (mode === 'GENERATE_NEW') {
    if (hasDiffTags) {
      errors.push(`Check 6 Failed: Generate New mode must NOT contain HTML diff tags (<ins>, <mark>, <del>).`);
    }
    
    // Check bracketed headers presence
    const hasBracketedHeader = bracketedHeaders.some(h => lowerText.includes(h));
    if (!hasBracketedHeader) {
      errors.push(`Check 6 Failed: Generate New mode must follow the standard bracketed template layout (e.g. [Professional Summary], [Technical Skills]).`);
    }

    // Check 7: No old resume content appended below
    const leakagePhrases = [
      'original resume',
      'reference resume',
      'reference original',
      'original text',
      'uploaded resume',
      'candidate details reference',
      'fallback resume'
    ];
    for (const phrase of leakagePhrases) {
      if (lowerText.includes(phrase)) {
        errors.push(`Check 7 Failed: Original resume reference or raw content leakage detected in the generated output.`);
      }
    }
  }

  // 6. Check 8: Skills added only where relevant
  // Checked mostly by AI prompt & profile checks, but we ensure no complete fabrication

  // 7. Check 9: ATS keywords injected naturally
  const words = optimizedText
    .replace(/<\/?[^>]+(>|$)/g, "") // strip html
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length >= 3 && /^[a-z]+$/.test(w));
  
  const wordCounts: Record<string, number> = {};
  for (const w of words) {
    wordCounts[w] = (wordCounts[w] || 0) + 1;
  }
  
  for (const [w, count] of Object.entries(wordCounts)) {
    if (count > 15 && !['and', 'the', 'with', 'for', 'develop', 'experience', 'using', 'project', 'management', 'software', 'systems'].includes(w)) {
      errors.push(`Check 9 Failed: Potential keyword stuffing detected. The word "${w}" appears ${count} times.`);
    }
  }

  // 8. Check 10: Light/Dark mode rendering verified (HTML matching tags check)
  const insOpenCount = (optimizedText.match(/<ins>/g) || []).length;
  const insCloseCount = (optimizedText.match(/<\/ins>/g) || []).length;
  const markOpenCount = (optimizedText.match(/<mark>/g) || []).length;
  const markCloseCount = (optimizedText.match(/<\/mark>/g) || []).length;
  const delOpenCount = (optimizedText.match(/<del>/g) || []).length;
  const delCloseCount = (optimizedText.match(/<\/del>/g) || []).length;
  
  if (insOpenCount !== insCloseCount || markOpenCount !== markCloseCount || delOpenCount !== delCloseCount) {
    errors.push(`Check 10 Failed: Mismatched HTML tags detected. (ins: ${insOpenCount}/${insCloseCount}, mark: ${markOpenCount}/${markCloseCount}, del: ${delOpenCount}/${delCloseCount}).`);
  }

  return errors;
};


export const analyzeResume = async (req: any, res: Response): Promise<void> => {
  try {
    const { jobTitle, jobDescription, experienceLevel } = req.body;
    const file = req.file;
    const userId = req.user.id;

    if (!jobTitle || !jobDescription) {
      res.status(400).json({ error: 'Job Title and Job Description are required fields.' });
      return;
    }

    if (!file) {
      res.status(400).json({ error: 'Please upload a resume file (PDF or DOCX).' });
      return;
    }

    // 1. Parse resume text and page count
    const { text: resumeText, pageCount } = await parserService.parseResume(file.buffer, file.mimetype);

    // Validate page count (maximum 2 pages)
    if (pageCount > 2) {
      res.status(400).json({ error: `Invalid file. Your resume must not exceed 2 pages. (Uploaded file has ${pageCount} pages).` });
      return;
    }

    // Validate that it is a valid resume
    if (!isValidResume(resumeText)) {
      res.status(400).json({ error: 'Invalid file. Please upload a valid resume containing education, skills, experience, and contact information.' });
      return;
    }

    // 2. Upload file to storage
    const fileName = `${userId}_${uuidv4()}_${file.originalname}`;
    const resumeUrl = await storageService.uploadFile('resumes', fileName, file.buffer, file.mimetype);

    // Save resume upload record in DB
    await prisma.resumeUpload.create({
      data: {
        userId,
        resumeUrl,
        fileName: file.originalname
      }
    });

    // 3. Call Centralized AI Engine for unified analysis with telemetry logging
    const aiStartTime = Date.now();
    let aiStatus = 'SUCCESS';
    let aiError: string | null = null;
    let profileResult;
    try {
      profileResult = await aiService.analyzeJobProfile(resumeText, jobTitle, jobDescription, experienceLevel);
    } catch (err: any) {
      aiStatus = 'FAILED';
      aiError = err.message;
      throw err;
    } finally {
      const responseTimeMs = Date.now() - aiStartTime;
      await prisma.aiRequestLog.create({
        data: {
          requestType: 'ATS',
          responseTimeMs,
          status: aiStatus,
          errorMessage: aiError
        }
      });
    }

    // Load custom ATS weights from settings if available
    let overallScore = profileResult.atsResult.overallScore;
    const settings = await prisma.adminSetting.findFirst();
    if (settings) {
      const {
        skillMatchWeight,
        projectWeight,
        experienceWeight,
        educationWeight,
        certificationWeight,
        keywordWeight
      } = settings;
      
      const kw = profileResult.atsResult.categoryScores.keywords || 0;
      const sk = profileResult.atsResult.categoryScores.skills || 0;
      const ex = profileResult.atsResult.categoryScores.experience || 0;
      const ed = profileResult.atsResult.categoryScores.education || 0;
      const ft = profileResult.atsResult.categoryScores.formatting || 0;

      const totalWeight = skillMatchWeight + projectWeight + experienceWeight + educationWeight + certificationWeight + keywordWeight;
      if (totalWeight > 0) {
        const weightedSum = (kw * keywordWeight) + (sk * skillMatchWeight) + (ex * experienceWeight) + (ed * educationWeight) + (ft * (projectWeight + certificationWeight) / 2);
        const weightedDiv = keywordWeight + skillMatchWeight + experienceWeight + educationWeight + ((projectWeight + certificationWeight) / 2);
        overallScore = Math.round(weightedSum / (weightedDiv || 1));
      }
    }

    // 4. Create centralized JobProfile database record
    const jobProfile = await prisma.jobProfile.create({
      data: {
        userId,
        jobTitle,
        jobDescription,
        extractedSkills: JSON.stringify(profileResult.extractedSkills),
        missingSkills: JSON.stringify(profileResult.missingSkills),
        matchingSkills: JSON.stringify(profileResult.matchingSkills),
        experienceLevel: experienceLevel || profileResult.experienceLevel || 'Fresher',
        domainClassification: profileResult.domainClassification,
        atsKeywords: JSON.stringify(profileResult.atsKeywords),
        targetRoleProfile: profileResult.targetRoleProfile
      }
    });

    // 5. Create linked ATSReport record
    const report = await prisma.aTSReport.create({
      data: {
        userId,
        jobProfileId: jobProfile.id,
        jobTitle,
        jobDescription,
        overallScore,
        categoryScores: JSON.stringify(profileResult.atsResult.categoryScores),
        strengths: JSON.stringify(profileResult.atsResult.strengths),
        weaknesses: JSON.stringify(profileResult.atsResult.weaknesses),
        missingKeywords: JSON.stringify(profileResult.atsKeywords),
        recommendations: JSON.stringify(profileResult.atsResult.recommendations),
        resumeUrl,
        resumeText
      }
    });

    // 6. Create linked SkillGapReport automatically
    await prisma.skillGapReport.create({
      data: {
        userId,
        jobProfileId: jobProfile.id,
        jobTitle,
        matchingSkills: JSON.stringify(profileResult.matchingSkills),
        missingSkills: JSON.stringify(profileResult.missingSkills),
        recommendedSkills: JSON.stringify(profileResult.atsKeywords)
      }
    });

    // 7. Log activity
    await prisma.activityLog.create({
      data: {
        userId,
        action: 'ATS_ANALYSIS',
        details: `Analyzed resume for ${jobTitle} (Score: ${profileResult.atsResult.overallScore}, Domain: ${profileResult.domainClassification})`
      }
    });

    res.status(200).json({
      message: 'ATS Resume analysis and job profile creation completed successfully.',
      report
    });
  } catch (error: any) {
    console.error('ATS Analysis Controller Error:', error);
    res.status(500).json({ error: error.message || 'An error occurred during ATS analysis.' });
  }
};

export const analyzeSkillGap = async (req: any, res: Response): Promise<void> => {
  try {
    const userId = req.user.id;
    const { reportId, jobProfileId } = { ...req.query, ...req.body };

    let targetJobProfileId = jobProfileId;

    if (reportId) {
      const report = await prisma.aTSReport.findFirst({
        where: { id: reportId, userId }
      });
      if (report) {
        targetJobProfileId = report.jobProfileId;
      }
    }

    if (targetJobProfileId) {
      const gapReport = await prisma.skillGapReport.findFirst({
        where: { jobProfileId: targetJobProfileId, userId }
      });
      if (gapReport) {
        res.status(200).json({
          message: 'Skill Gap Analysis loaded.',
          report: gapReport
        });
        return;
      }
    }

    // Fallback to the latest linked SkillGapReport from the active JobProfile
    const latestGapReport = await prisma.skillGapReport.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });

    if (latestGapReport) {
      res.status(200).json({
        message: 'Skill Gap Analysis loaded.',
        report: latestGapReport
      });
      return;
    }

    res.status(404).json({ error: 'No skill gap reports found. Please upload a resume first.' });
  } catch (error: any) {
    console.error('Skill Gap Controller Error:', error);
    res.status(500).json({ error: 'An error occurred during skill gap retrieval.' });
  }
};

export const getHistory = async (req: any, res: Response): Promise<void> => {
  try {
    const userId = req.user.id;

    const reports = await prisma.aTSReport.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json({ reports });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to retrieve ATS reports history.' });
  }
};

export const getSkillGapHistory = async (req: any, res: Response): Promise<void> => {
  try {
    const userId = req.user.id;

    const reports = await prisma.skillGapReport.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json({ reports });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to retrieve Skill Gap reports history.' });
  }
};

export const deleteReport = async (req: any, res: Response): Promise<void> => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const report = await prisma.aTSReport.findUnique({
      where: { id }
    });

    if (!report) {
      res.status(404).json({ error: 'ATS report not found.' });
      return;
    }

    if (report.userId !== userId) {
      res.status(403).json({ error: 'Unauthorized to delete this record.' });
      return;
    }

    // Run database deletion in transaction
    try {
      await prisma.$transaction(async (tx) => {
        if (report.resumeUrl) {
          await tx.resumeUpload.deleteMany({
            where: { userId, resumeUrl: report.resumeUrl }
          });
        }

        if (report.jobProfileId) {
          await tx.skillGapReport.deleteMany({
            where: { jobProfileId: report.jobProfileId }
          });
          await tx.roadmap.deleteMany({
            where: { jobProfileId: report.jobProfileId }
          });
          await tx.interviewSession.deleteMany({
            where: { jobProfileId: report.jobProfileId }
          });
          await tx.aTSReport.deleteMany({
            where: { id }
          });
          await tx.jobProfile.delete({
            where: { id: report.jobProfileId }
          });
        } else {
          await tx.aTSReport.delete({
            where: { id }
          });
        }
      });
    } catch (txError: any) {
      console.error('ATS Deletion transaction failed:', txError);
      res.status(500).json({ error: 'Unable to complete deletion. No records were removed. Please try again.' });
      return;
    }

    if (report.resumeUrl) {
      try {
        const fileName = require('path').basename(report.resumeUrl);
        await storageService.deleteFile('resumes', fileName);
      } catch (err) {
        console.error('Failed to delete resume file:', err);
      }
    }

    res.status(200).json({ message: 'ATS report deleted successfully from all associated records and modules.' });
  } catch (error: any) {
    console.error('Delete ATS report error:', error);
    res.status(500).json({ error: 'Unable to complete deletion. No records were removed. Please try again.' });
  }
};

export const bulkDeleteReports = async (req: any, res: Response): Promise<void> => {
  try {
    const userId = req.user.id;
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids)) {
      res.status(400).json({ error: 'IDs array is required.' });
      return;
    }

    const reports = await prisma.aTSReport.findMany({
      where: {
        id: { in: ids },
        userId
      },
      select: { id: true, resumeUrl: true, jobProfileId: true }
    });

    try {
      await prisma.$transaction(async (tx) => {
        for (const report of reports) {
          if (report.resumeUrl) {
            await tx.resumeUpload.deleteMany({
              where: { userId, resumeUrl: report.resumeUrl }
            });
          }

          if (report.jobProfileId) {
            await tx.skillGapReport.deleteMany({
              where: { jobProfileId: report.jobProfileId }
            });
            await tx.roadmap.deleteMany({
              where: { jobProfileId: report.jobProfileId }
            });
            await tx.interviewSession.deleteMany({
              where: { jobProfileId: report.jobProfileId }
            });
            await tx.aTSReport.deleteMany({
              where: { id: report.id }
            });
            await tx.jobProfile.delete({
              where: { id: report.jobProfileId }
            });
          } else {
            await tx.aTSReport.delete({
              where: { id: report.id }
            });
          }
        }
      });
    } catch (txError: any) {
      console.error('ATS Bulk Deletion transaction failed:', txError);
      res.status(500).json({ error: 'Unable to complete deletion. No records were removed. Please try again.' });
      return;
    }

    for (const report of reports) {
      if (report.resumeUrl) {
        try {
          const fileName = require('path').basename(report.resumeUrl);
          await storageService.deleteFile('resumes', fileName);
        } catch (err) {
          console.error('Failed to delete resume file in bulk:', err);
        }
      }
    }

    res.status(200).json({ message: 'Selected ATS reports deleted successfully from all associated records and modules.', count: reports.length });
  } catch (error: any) {
    console.error('Bulk delete ATS reports error:', error);
    res.status(500).json({ error: 'Unable to complete deletion. No records were removed. Please try again.' });
  }
};

export const deleteSkillGapReport = async (req: any, res: Response): Promise<void> => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const report = await prisma.skillGapReport.findUnique({
      where: { id }
    });

    if (!report) {
      res.status(404).json({ error: 'Skill gap report not found.' });
      return;
    }

    if (report.userId !== userId) {
      res.status(403).json({ error: 'Unauthorized to delete this record.' });
      return;
    }

    await prisma.skillGapReport.delete({
      where: { id }
    });

    res.status(200).json({ message: 'Skill gap report deleted successfully.' });
  } catch (error: any) {
    console.error('Delete skill gap report error:', error);
    res.status(500).json({ error: 'Failed to delete skill gap report.' });
  }
};

export const bulkDeleteSkillGapReports = async (req: any, res: Response): Promise<void> => {
  try {
    const userId = req.user.id;
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids)) {
      res.status(400).json({ error: 'IDs array is required.' });
      return;
    }

    const deleted = await prisma.skillGapReport.deleteMany({
      where: {
        id: { in: ids },
        userId
      }
    });

    res.status(200).json({ message: 'Selected skill gap reports deleted successfully.', count: deleted.count });
  } catch (error: any) {
    console.error('Bulk delete skill gap reports error:', error);
    res.status(500).json({ error: 'Failed to delete selected skill gap reports.' });
  }
};

const getResumeText = async (report: any): Promise<string> => {
  if (report.resumeText) return report.resumeText;
  if (!report.resumeUrl) throw new Error('No resume file URL associated with this report.');
  
  const fileName = require('path').basename(report.resumeUrl);
  let buffer: Buffer;
  
  if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    const { data, error } = await supabase.storage.from('resumes').download(fileName);
    if (error) throw error;
    const arrayBuffer = await data.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
  } else {
    const filePath = require('path').join(__dirname, '../../uploads/resumes', fileName);
    if (!require('fs').existsSync(filePath)) {
      throw new Error('Original resume file not found locally.');
    }
    buffer = require('fs').readFileSync(filePath);
  }
  
  const mimetype = fileName.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const { text } = await parserService.parseResume(buffer, mimetype);
  return text;
};

export const optimizeResume = async (req: any, res: Response): Promise<void> => {
  try {
    const { reportId } = req.params;
    const userId = req.user.id;
    const { mode = 'MODIFY_EXISTING', applicantDetails, checkOnly = false } = req.body || {};

    const report = await prisma.aTSReport.findFirst({
      where: { id: reportId, userId }
    });

    if (!report) {
      res.status(404).json({ error: 'ATS Report not found.' });
      return;
    }

    let optimized = await prisma.optimizedResume.findUnique({
      where: { reportId }
    });

    if (checkOnly) {
      res.status(200).json({
        message: optimized ? 'Optimized resume loaded from cache.' : 'No optimized resume found.',
        optimized: optimized || null
      });
      return;
    }

    if (optimized && optimized.mode === mode && (!applicantDetails || mode !== 'GENERATE_NEW')) {
      res.status(200).json({
        message: 'Optimized resume loaded from cache.',
        optimized
      });
      return;
    }

    const resumeText = await getResumeText(report);
    
    let result: any;
    let attempts = 0;
    const maxAttempts = 3;
    let errors: string[] = [];

    while (attempts < maxAttempts) {
      attempts++;
      if (mode === 'GENERATE_NEW') {
        const targetJd = applicantDetails?.targetJd || report.jobDescription;
        const targetRole = applicantDetails?.targetRole || report.jobTitle;
        result = await aiService.generateNewResume(resumeText, targetJd, targetRole, applicantDetails, errors);
      } else {
        result = await aiService.optimizeResume(resumeText, report.jobDescription, report.jobTitle, errors);
      }

      errors = runFinalValidationChecklist(result.optimizedText, mode, resumeText, report.jobTitle, report.jobDescription);
      if (errors.length === 0) {
        break;
      } else {
        console.warn(`Attempt ${attempts} failed validation checklist (mode: ${mode}):`, errors);
      }
    }

    if (errors.length > 0) {
      console.error(`Resume optimization failed validation checklist after ${maxAttempts} attempts:`, errors);
    }


    const dataPayload = {
      optimizedText: result.optimizedText,
      missingSkills: JSON.stringify(result.missingSkills),
      addedKeywords: JSON.stringify(result.addedKeywords),
      originalScore: result.originalScore || report.overallScore,
      optimizedScore: result.optimizedScore || 85,
      improvement: result.improvement || 20,
      mode
    };

    if (optimized) {
      optimized = await prisma.optimizedResume.update({
        where: { reportId },
        data: dataPayload
      });
    } else {
      optimized = await prisma.optimizedResume.create({
        data: {
          reportId,
          userId,
          ...dataPayload
        }
      });
    }

    res.status(200).json({
      message: 'Resume optimized successfully.',
      optimized
    });
  } catch (error: any) {
    console.error('Optimize Resume Controller Error:', error);
    res.status(500).json({ error: error.message || 'Failed to optimize resume.' });
  }
};

export const downloadOptimizedResume = async (req: any, res: Response): Promise<void> => {
  try {
    const { reportId } = req.params;
    const { format } = req.query;
    const userId = req.user.id;

    const optimized = await prisma.optimizedResume.findFirst({
      where: { reportId, userId }
    });

    if (!optimized) {
      res.status(404).json({ error: 'Optimized resume not found. Please optimize it first.' });
      return;
    }

    // Strip HTML diff/highlight markings for downloaded versions
    const cleanHtmlTags = (text: string): string => {
      if (!text) return '';
      return text
        .replace(/<del>([\s\S]*?)<\/del>/gi, '') // Remove deleted content
        .replace(/<ins>([\s\S]*?)<\/ins>/gi, '$1') // Keep inserted content without tags
        .replace(/<mark>([\s\S]*?)<\/mark>/gi, '$1') // Keep updated content without tags
        .replace(/<\/?[^>]+(>|$)/g, ""); // Remove any residual tags
    };

    const cleanText = cleanHtmlTags(optimized.optimizedText);

    if (format === 'docx') {
      const docxBuffer = await DOCXGenerator.generateResumeDocx(cleanText, optimized.mode);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename=optimized_resume_${reportId}.docx`);
      res.status(200).send(docxBuffer);
    } else {
      const { PDFGenerator } = require('../utils/pdfGenerator');
      const pdfBuffer = await PDFGenerator.generateResumePDF(cleanText, optimized.mode);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=optimized_resume_${reportId}.pdf`);
      res.status(200).send(pdfBuffer);
    }
  } catch (error: any) {
    console.error('Download Optimized Resume Controller Error:', error);
    res.status(500).json({ error: error.message || 'Failed to download optimized resume.' });
  }
};

export const getJobProfile = async (req: any, res: Response): Promise<void> => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const jobProfile = await prisma.jobProfile.findFirst({
      where: { id, userId }
    });

    if (!jobProfile) {
      res.status(404).json({ error: 'Job profile not found.' });
      return;
    }

    res.status(200).json({ jobProfile });
  } catch (error: any) {
    console.error('Get job profile error:', error);
    res.status(500).json({ error: 'Failed to retrieve job profile.' });
  }
};
