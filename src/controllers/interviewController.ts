import { Response } from 'express';
import { prisma } from '../lib/prisma';
import { AIService } from '../services/aiService';
import { StorageService } from '../services/storageService';
import { v4 as uuidv4 } from 'uuid';

const aiService = new AIService();
const storageService = new StorageService();

/**
 * Initializes a new interview session and populates questions dynamically from JobProfile
 */
export const startSession = async (req: any, res: Response): Promise<void> => {
  try {
    const { type, company, difficulty, questionCount, role, experienceLevel, questionSource, customQuestions } = req.body;
    const userId = req.user.id;

    if (!type || !company || !difficulty || !questionCount) {
      res.status(400).json({ error: 'All configuration fields are required to start an interview session.' });
      return;
    }

    let count = parseInt(questionCount, 10);
    if (isNaN(count) || count < 1 || count > 25) {
      res.status(400).json({ error: 'Question count must be a positive number up to 25.' });
      return;
    }

    // 1. Fetch latest active JobProfile for this user if available
    const latestAts = await prisma.aTSReport.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });

    let targetRole = role;
    let targetExperience = experienceLevel;
    let jobProfile = null;
    let missingSkills: string[] = [];

    if (latestAts && latestAts.jobProfileId) {
      jobProfile = await prisma.jobProfile.findUnique({
        where: { id: latestAts.jobProfileId }
      });
      if (jobProfile) {
        if (!targetRole) {
          targetRole = jobProfile.domainClassification;
        }
        if (!targetExperience) {
          targetExperience = jobProfile.experienceLevel;
        }
        try {
          const missingSkillsObj = JSON.parse(jobProfile.missingSkills);
          missingSkills = Array.isArray(missingSkillsObj)
            ? missingSkillsObj.map((s: any) => typeof s === 'string' ? s : (s.skill || ''))
            : [];
        } catch (e) {
          console.warn('Failed to parse missing skills:', e);
        }
      }
    }

    if (!targetRole) {
      res.status(400).json({ error: 'Job role is required to start the interview.' });
      return;
    }
    if (!targetExperience) {
      res.status(400).json({ error: 'Experience level is required to start the interview.' });
      return;
    }

    // 2. Fetch questions from chosen Question Source
    let finalQuestions: Array<{
      text: string;
      expectedAnswer: string;
      expectedConcepts: string[];
      keySkills: string[];
      importantKeywords: string[];
      evaluationRubric: string;
    }> = [];

    const source = questionSource || 'AI';

    if (source === 'CUSTOM') {
      if (!Array.isArray(customQuestions) || customQuestions.length === 0) {
        res.status(400).json({ error: 'Please provide at least one custom question.' });
        return;
      }
      finalQuestions = customQuestions.map((qText: any) => ({
        text: String(qText).trim(),
        expectedAnswer: "Explain concepts clearly matching your background and target seniority.",
        expectedConcepts: ["Core concepts", "Validation & testing"],
        keySkills: [targetRole],
        importantKeywords: [],
        evaluationRubric: "Assess correctness, structure, and communication."
      }));
      count = finalQuestions.length;
    } else if (source === 'ADMIN' || source === 'COMPANY') {
      const queryWhere: any = {
        role: { equals: targetRole, mode: 'insensitive' },
        difficulty: { equals: difficulty, mode: 'insensitive' },
        status: 'ACTIVE'
      };

      if (source === 'COMPANY' && company !== 'General Interview') {
        queryWhere.company = { equals: company, mode: 'insensitive' };
      }

      const dbQuestions = await prisma.questionBank.findMany({
        where: queryWhere,
        take: count
      });

      if (dbQuestions.length > 0) {
        finalQuestions = dbQuestions.map(dq => {
          let parsedConcepts: string[] = [];
          let parsedTags: string[] = [];
          try {
            if (dq.keyConcepts) parsedConcepts = JSON.parse(dq.keyConcepts);
            if (dq.tags) parsedTags = JSON.parse(dq.tags);
          } catch (e) {}

          return {
            text: dq.questionText,
            expectedAnswer: dq.expectedAnswer,
            expectedConcepts: parsedConcepts,
            keySkills: parsedTags,
            importantKeywords: parsedTags.map(t => t.toLowerCase()),
            evaluationRubric: dq.evaluationCriteria || ''
          };
        });
      }
    }

    // Fill up remaining required count with AI generated questions
    const remainingCount = source === 'CUSTOM' ? 0 : count - finalQuestions.length;
    if (remainingCount > 0) {
      const aiStartTime = Date.now();
      let aiStatus = 'SUCCESS';
      let aiError: string | null = null;
      let generatedQuestions: any[] = [];
      try {
        generatedQuestions = await aiService.generateInterviewQuestions(
          targetRole,
          company,
          difficulty,
          type,
          remainingCount,
          missingSkills,
          targetExperience
        );
      } catch (err: any) {
        aiStatus = 'FAILED';
        aiError = err.message;
        console.warn('AI question generation failed, using dynamic fallbacks:', err);
        const fallbackSkills = missingSkills.length > 0 ? missingSkills : ['Performance Optimization', 'Architecture Design'];
        for (let i = 0; i < remainingCount; i++) {
          const skill = fallbackSkills[i % fallbackSkills.length];
          const text = `Describe a scenario where you applied your knowledge of ${skill} on a critical ${targetRole} pipeline at ${company}.`;
          const expectedAnswer = `Explain how to debug, optimize, and test the performance of ${skill} within target ${targetRole} standards.`;
          generatedQuestions.push({
            text,
            expectedAnswer,
            expectedConcepts: [skill, `${targetRole} architecture`, 'Testing & validation'],
            keySkills: [skill, targetRole],
            importantKeywords: [skill.toLowerCase(), 'architecture', 'performance', 'optimization'],
            evaluationRubric: `Grade response on: 1. ${skill} explanation. 2. Engineering trade-offs. 3. Specific validation steps.`
          });
        }
      } finally {
        const responseTimeMs = Date.now() - aiStartTime;
        await prisma.aiRequestLog.create({
          data: {
            requestType: 'INTERVIEW',
            responseTimeMs,
            status: aiStatus,
            errorMessage: aiError
          }
        });
      }

      finalQuestions = [...finalQuestions, ...generatedQuestions.slice(0, remainingCount)];
    }

    // Capped exact count
    finalQuestions = finalQuestions.slice(0, count);

    // 3. Create Session in DB
    const session = await prisma.interviewSession.create({
      data: {
        userId,
        jobProfileId: jobProfile ? jobProfile.id : null,
        type,
        role: targetRole,
        company,
        difficulty,
        experienceLevel: targetExperience,
        questionCount: count,
        status: 'STARTED',
      }
    });

    // 4. Create Session Questions (saving all hidden criteria fields)
    await prisma.interviewQuestion.createMany({
      data: finalQuestions.map((q, index) => ({
        sessionId: session.id,
        text: q.text,
        orderIndex: index,
        expectedAnswer: q.expectedAnswer,
        expectedConcepts: q.expectedConcepts ? JSON.stringify(q.expectedConcepts) : '[]',
        keySkills: q.keySkills ? JSON.stringify(q.keySkills) : '[]',
        importantKeywords: q.importantKeywords ? JSON.stringify(q.importantKeywords) : '[]',
        evaluationRubric: q.evaluationRubric || ''
      }))
    });

    // Fetch the full session with questions to return
    const fullSession = await prisma.interviewSession.findUnique({
      where: { id: session.id },
      include: {
        questions: {
          orderBy: { orderIndex: 'asc' }
        }
      }
    });

    // Log Activity
    await prisma.activityLog.create({
      data: {
        userId,
        action: 'INTERVIEW_START',
        details: `Started ${type} mock room for ${targetRole} at ${company} (ID: ${session.id})`
      }
    });

    res.status(200).json({
      message: 'Interview session created.',
      session: fullSession
    });
  } catch (error: any) {
    console.error('Start Interview Session Error:', error);
    res.status(500).json({ error: error.message || 'Failed to start interview session.' });
  }
};

/**
 * Submits an answer for evaluation
 */
export const submitAnswer = async (req: any, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.params;
    const { questionId, answerText, behavioralTelemetry } = req.body;
    const files = req.files as { [fieldname: string]: any[] } | undefined;
    const voiceFile = files && files['voice'] ? files['voice'][0] : null;
    const videoFile = files && files['video'] ? files['video'][0] : null;
    const userId = req.user.id;

    if (!questionId) {
      res.status(400).json({ error: 'Question ID is required.' });
      return;
    }

    if (!answerText && !voiceFile && !videoFile) {
      res.status(400).json({ error: 'Please provide either typed text, a voice recording, or a video recording.' });
      return;
    }

    // Verify question and session belongs to user
    const question = await prisma.interviewQuestion.findFirst({
      where: {
        id: questionId,
        sessionId: sessionId,
        session: { userId }
      }
    });

    if (!question) {
      res.status(404).json({ error: 'Question or session context not found.' });
      return;
    }

    let voiceRecordingUrl: string | null = null;
    let videoRecordingUrl: string | null = null;
    let finalAnswerText = answerText || '';

    if (voiceFile) {
      const fileName = `${userId}_${sessionId}_${questionId}_${uuidv4()}.webm`;
      voiceRecordingUrl = await storageService.uploadFile('voice', fileName, voiceFile.buffer, voiceFile.mimetype);
    }

    if (videoFile) {
      const fileName = `${userId}_${sessionId}_${questionId}_${uuidv4()}.webm`;
      videoRecordingUrl = await storageService.uploadFile('video', fileName, videoFile.buffer, videoFile.mimetype);
    }

    // Parse behavioral telemetry
    let telemetry: any = null;
    if (behavioralTelemetry) {
      try {
        telemetry = typeof behavioralTelemetry === 'string' ? JSON.parse(behavioralTelemetry) : behavioralTelemetry;
      } catch (e) {
        console.warn('Failed to parse behavioral telemetry:', e);
      }
    }

    // Speaking Pace (WPM)
    const words = finalAnswerText.trim().split(/\s+/).filter(Boolean).length;
    let duration = 15;
    if (telemetry?.durationSeconds) {
      duration = telemetry.durationSeconds;
    } else if (words > 0) {
      duration = Math.max(5, words / 2.2); // Estimate ~130 WPM
    }
    const speakingPaceWpm = Math.round((words / duration) * 60);

    let speakingPaceFeedback = '';
    if (speakingPaceWpm >= 110 && speakingPaceWpm <= 150) {
      speakingPaceFeedback = `Your speaking pace of ${speakingPaceWpm} WPM is within the ideal range (110-150 WPM).`;
    } else if (speakingPaceWpm < 110) {
      speakingPaceFeedback = `Your speaking pace of ${speakingPaceWpm} WPM is a bit slow. Try to speak more dynamically.`;
    } else {
      speakingPaceFeedback = `Your speaking pace of ${speakingPaceWpm} WPM is too fast. Try to slow down and articulate your words clearly.`;
    }

    // Filler Word Detection
    const fillerWordsList = ['umm', 'uh', 'like', 'basically', 'you know', 'actually'];
    const fillerWordsCountMap: Record<string, number> = {};
    let totalFillers = 0;
    fillerWordsList.forEach(word => {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      const matches = finalAnswerText.match(regex);
      const count = matches ? matches.length : 0;
      if (count > 0) {
        fillerWordsCountMap[word] = count;
        totalFillers += count;
      }
    });

    const hasVideo = !!videoRecordingUrl;
    const hasVoice = !!voiceRecordingUrl;

    // Base behavioral metrics from telemetry or defaults (only if video is recorded)
    const eyeContactScore = hasVideo ? (telemetry?.eyeContactScore !== undefined ? parseInt(telemetry.eyeContactScore, 10) : 85) : null;
    const bodyLanguageScore = hasVideo ? (telemetry?.bodyLanguageScore !== undefined ? parseInt(telemetry.bodyLanguageScore, 10) : 80) : null;
    const voiceQualityScore = (hasVideo || hasVoice) ? (telemetry?.voiceQualityScore !== undefined ? parseInt(telemetry.voiceQualityScore, 10) : 80) : null;
    const professionalismScore = hasVideo ? (telemetry?.professionalismScore !== undefined ? parseInt(telemetry.professionalismScore, 10) : 85) : null;

    // Calculate overall behavioral score
    let behavioralScore = null;
    if (hasVideo) {
      behavioralScore = Math.round(((eyeContactScore || 0) + (bodyLanguageScore || 0) + (voiceQualityScore || 0) + (professionalismScore || 0)) / 4);
    } else if (hasVoice) {
      behavioralScore = voiceQualityScore;
    }

    const eyeContactFeedback = (eyeContactScore !== null && eyeContactScore >= 80)
      ? 'Excellent eye contact maintained with the camera.'
      : (eyeContactScore !== null ? 'Frequent looking away detected. Try focusing directly on the camera lens.' : 'Video camera was off. No eye gaze analysis performed.');

    const facialExpressionsFeedback = hasVideo ? (telemetry?.facialExpressionsFeedback || 'Expression appeared confident, professional, and composed.') : 'Video was off.';
    const smileFeedback = hasVideo ? (telemetry?.smileFeedback || 'Natural smiles observed, displaying positive engagement.') : 'Video was off.';
    const headMovementFeedback = hasVideo ? (telemetry?.headMovementFeedback || 'Consistent posture maintained. Attention level remained high.') : 'Video was off.';
    const bodyLanguageFeedback = hasVideo ? (telemetry?.bodyLanguageFeedback || 'Sitting posture was stable. Professional appearance.') : 'Video was off.';
    const confidenceFeedback = telemetry?.confidenceFeedback || 'Strong verbal confidence. Hesitation was low.';
    const pauseFeedback = telemetry?.pauseFeedback || 'Natural pauses observed during response flow.';
    const voiceAnalysisFeedback = telemetry?.voiceAnalysisFeedback || 'Volume and clarity remained professional.';

    const behavioralDetailsJson = JSON.stringify({
      eyeContactFeedback,
      facialExpressionsFeedback,
      smileFeedback,
      headMovementFeedback,
      bodyLanguageFeedback,
      confidenceFeedback,
      speakingPaceFeedback,
      speakingPaceWpm,
      fillerWordCount: totalFillers,
      fillerWordsList: fillerWordsCountMap,
      voiceAnalysisFeedback,
      pauseFeedback
    });

    // Fetch hidden rubric details directly from the session's interview question
    const expected = question.expectedAnswer || 'A response matching candidate profiles, demonstrating architectural trade-offs, structured methodologies, and key metrics.';
    let expectedConcepts: string[] = [];
    let keySkills: string[] = [];
    let importantKeywords: string[] = [];
    try {
      if (question.expectedConcepts) expectedConcepts = JSON.parse(question.expectedConcepts);
      if (question.keySkills) keySkills = JSON.parse(question.keySkills);
      if (question.importantKeywords) importantKeywords = JSON.parse(question.importantKeywords);
    } catch (e) {
      console.warn('Failed to parse question JSON metadata arrays:', e);
    }
    const evaluationRubric = question.evaluationRubric || '';

    // Run AI Evaluation with telemetry log
    const aiStartTime = Date.now();
    let aiStatus = 'SUCCESS';
    let aiError: string | null = null;
    let evalResult;
    try {
      evalResult = await aiService.evaluateAnswer(
        question.text,
        finalAnswerText,
        expected,
        expectedConcepts,
        keySkills,
        importantKeywords,
        evaluationRubric
      );
    } catch (err: any) {
      aiStatus = 'FAILED';
      aiError = err.message;
      throw err;
    } finally {
      const responseTimeMs = Date.now() - aiStartTime;
      await prisma.aiRequestLog.create({
        data: {
          requestType: 'INTERVIEW',
          responseTimeMs,
          status: aiStatus,
          errorMessage: aiError
        }
      });
    }

    // Load custom settings weights if available
    let score = evalResult.score;
    const settings = await prisma.adminSetting.findFirst();
    if (settings) {
      const {
        technicalScoreWeight,
        communicationWeight,
        confidenceWeight,
        problemSolvingWeight,
        domainKnowledgeWeight
      } = settings;

      const tech = evalResult.correctnessScore || 0;
      const comm = evalResult.communicationScore || 0;
      const conf = evalResult.confidenceScore || 0;
      const prob = evalResult.grammarScore || 0;
      const dom = evalResult.conceptCoverage || 0;

      const totalWeight = technicalScoreWeight + communicationWeight + confidenceWeight + problemSolvingWeight + domainKnowledgeWeight;
      if (totalWeight > 0) {
        score = Math.round(
          (tech * technicalScoreWeight +
           comm * communicationWeight +
           conf * confidenceWeight +
           prob * problemSolvingWeight +
           dom * domainKnowledgeWeight) / totalWeight
        );
      }
    }

    // Enforce strict zero score if the raw AI output score was 0
    if (evalResult.score === 0) {
      score = 0;
    }

    // Save or update Answer in DB
    const answer = await prisma.interviewAnswer.upsert({
      where: { questionId },
      update: {
        answerText: finalAnswerText,
        voiceRecordingUrl,
        videoRecordingUrl,
        score,
        correctnessScore: evalResult.correctnessScore,
        communicationScore: evalResult.communicationScore,
        confidenceScore: evalResult.confidenceScore,
        grammarScore: evalResult.grammarScore,
        expectedAnswer: evalResult.expectedAnswer,
        improvementTips: evalResult.improvementTips,
        missingConcepts: evalResult.missingConcepts ? JSON.stringify(evalResult.missingConcepts) : '[]',
        conceptCoverage: evalResult.conceptCoverage || 0,
        behavioralScore,
        eyeContactScore,
        bodyLanguageScore,
        voiceQualityScore,
        professionalismScore,
        behavioralDetails: behavioralDetailsJson
      },
      create: {
        questionId,
        userId,
        answerText: finalAnswerText,
        voiceRecordingUrl,
        videoRecordingUrl,
        score,
        correctnessScore: evalResult.correctnessScore,
        communicationScore: evalResult.communicationScore,
        confidenceScore: evalResult.confidenceScore,
        grammarScore: evalResult.grammarScore,
        expectedAnswer: evalResult.expectedAnswer,
        improvementTips: evalResult.improvementTips,
        missingConcepts: evalResult.missingConcepts ? JSON.stringify(evalResult.missingConcepts) : '[]',
        conceptCoverage: evalResult.conceptCoverage || 0,
        behavioralScore,
        eyeContactScore,
        bodyLanguageScore,
        voiceQualityScore,
        professionalismScore,
        behavioralDetails: behavioralDetailsJson
      }
    });

    if (voiceFile && voiceRecordingUrl) {
      await prisma.voiceRecording.create({
        data: {
          answerId: answer.id,
          storagePath: voiceRecordingUrl,
          durationSeconds: duration
        }
      });
    }

    // AI Dynamic Questioning (Live follow-up triggers) disabled to prevent count glitch
    let followUpCreated = null;

    const updatedQuestions = await prisma.interviewQuestion.findMany({
      where: { sessionId },
      orderBy: { orderIndex: 'asc' },
      include: { answer: true }
    });

    res.status(200).json({
      message: 'Answer submitted and evaluated.',
      evaluation: evalResult,
      questions: updatedQuestions,
      followUp: followUpCreated
    });
  } catch (error: any) {
    console.error('Submit Answer Error:', error);
    res.status(500).json({ error: error.message || 'Failed to submit and evaluate answer.' });
  }
};

/**
 * Completes the interview and summarizes average score and feedback
 */
export const completeSession = async (req: any, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.id;

    // Verify session belongs to user
    const session = await prisma.interviewSession.findFirst({
      where: { id: sessionId, userId },
      include: {
        questions: {
          include: { answer: true }
        }
      }
    });

    if (!session) {
      res.status(404).json({ error: 'Interview session not found.' });
      return;
    }

    const answeredQuestions = session.questions.filter(q => q.answer);
    if (answeredQuestions.length === 0) {
      res.status(400).json({ error: 'Cannot complete a session with no answered questions.' });
      return;
    }

    let totalScore = 0;
    let totalCorrectness = 0;
    let totalComm = 0;
    let totalConf = 0;
    let totalGrammar = 0;
    let totalBehavioral = 0;
    let totalProfessionalism = 0;
    let videoAnswersCount = 0;

    answeredQuestions.forEach(q => {
      if (q.answer) {
        totalScore += q.answer.score;
        totalCorrectness += q.answer.correctnessScore;
        totalComm += q.answer.communicationScore;
        totalConf += q.answer.confidenceScore;
        totalGrammar += q.answer.grammarScore;
        if (q.answer.videoRecordingUrl) {
          totalBehavioral += q.answer.behavioralScore || 0;
          totalProfessionalism += q.answer.professionalismScore || 0;
          videoAnswersCount++;
        }
      }
    });

    const count = answeredQuestions.length;
    const overallScore = Math.round(totalScore / count);
    const correctnessScore = Math.round(totalCorrectness / count);
    const communicationScore = Math.round(totalComm / count);
    const confidenceScore = Math.round(totalConf / count);
    const grammarScore = Math.round(totalGrammar / count);
    const behavioralScore = videoAnswersCount > 0 ? Math.round(totalBehavioral / videoAnswersCount) : null;
    const professionalismScore = videoAnswersCount > 0 ? Math.round(totalProfessionalism / videoAnswersCount) : null;
    const leadershipPresenceScore = behavioralScore !== null
      ? Math.round((confidenceScore + communicationScore + behavioralScore) / 3)
      : Math.round((confidenceScore + communicationScore) / 2);

    // AI Strengths and Improvements lists
    const strengthsList: string[] = [];
    if (communicationScore >= 80) strengthsList.push('Clear communication and solid structured responses.');
    if (confidenceScore >= 80) strengthsList.push('High confidence presence and steady presentation delivery.');
    if (behavioralScore !== null && behavioralScore >= 80) strengthsList.push('Strong eye contact and steady camera engagement posture.');
    if (professionalismScore !== null && professionalismScore >= 80) strengthsList.push('Professional tone, style, and solid overall presentation.');
    if (strengthsList.length === 0) strengthsList.push('Satisfactory response structure and interview pacing.');

    const improvementsList: string[] = [];
    if (communicationScore < 80) improvementsList.push('Practice structuring technical explanations and speak dynamically.');
    if (confidenceScore < 80) improvementsList.push('Work on reducing pauses and voice hesitations under pressure.');
    if (behavioralScore !== null && behavioralScore < 80) improvementsList.push('Try to keep looking at the camera lens rather than looking away.');
    if (professionalismScore !== null && professionalismScore < 80) improvementsList.push('Work on posture stability and reduce usage of filler words.');
    if (improvementsList.length === 0) improvementsList.push('Aim to improve keyword density and technical depth.');

    const behavioralStrengths = JSON.stringify(strengthsList);
    const behavioralImprovements = JSON.stringify(improvementsList);

    let feedback = `The candidate completed a ${session.type} session for ${session.role}. Overall performance was ${overallScore >= 80 ? 'EXCELLENT' : overallScore >= 60 ? 'GOOD' : 'AVERAGE'}. Strengths include: solid communication pacing, structured explanations. Focus areas should be: study specific details, expected edge-cases.`;
    if (overallScore === 0) {
      feedback = `The candidate completed a ${session.type} session for ${session.role}. Overall performance was poor (Score: 0%). Weaknesses: Did not answer questions, Missing core concepts, Technical understanding absent. No positive feedback was generated as the candidate did not provide meaningful technical answers.`;
    }

    // Update session details
    const completedSession = await prisma.interviewSession.update({
      where: { id: sessionId },
      data: {
        status: 'COMPLETED',
        overallScore,
        communicationScore,
        technicalScore: correctnessScore,
        confidenceScore,
        grammarScore,
        behavioralScore,
        professionalismScore,
        leadershipPresenceScore,
        behavioralStrengths,
        behavioralImprovements,
        feedback,
        endedAt: new Date()
      }
    });

    // Notify user of completion
    await prisma.notification.create({
      data: {
        userId,
        title: 'Interview Completed!',
        message: `Your ${session.type} interview for ${session.role} has been evaluated. Score: ${overallScore}/100.`,
        type: 'SUCCESS'
      }
    });

    // Log Activity
    await prisma.activityLog.create({
      data: {
        userId,
        action: 'INTERVIEW_COMPLETE',
        details: `Completed interview ${sessionId} (Score: ${overallScore})`
      }
    });

    res.status(200).json({
      message: 'Interview session completed successfully.',
      session: completedSession
    });
  } catch (error: any) {
    console.error('Complete Session Error:', error);
    res.status(500).json({ error: error.message || 'Failed to complete interview session.' });
  }
};

/**
 * Gets user interview history
 */
export const getHistory = async (req: any, res: Response): Promise<void> => {
  try {
    const userId = req.user.id;

    const sessions = await prisma.interviewSession.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json({ sessions });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to retrieve sessions history.' });
  }
};

/**
 * Gets detailed report of a completed interview session
 */
export const getReport = async (req: any, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.id;

    const session = await prisma.interviewSession.findFirst({
      where: { id: sessionId, userId },
      include: {
        questions: {
          orderBy: { orderIndex: 'asc' },
          include: { answer: true }
        }
      }
    });

    if (!session) {
      res.status(404).json({ error: 'Interview session report not found.' });
      return;
    }

    res.status(200).json({ session });
  } catch (error: any) {
    res.status(550).json({ error: 'Failed to retrieve session report.' });
  }
};

export const deleteSession = async (req: any, res: Response): Promise<void> => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const session = await prisma.interviewSession.findUnique({
      where: { id }
    });

    if (!session) {
      res.status(404).json({ error: 'Interview session not found.' });
      return;
    }

    if (session.userId !== userId) {
      res.status(403).json({ error: 'Unauthorized to delete this record.' });
      return;
    }

    // 1. Query files before deleting records
    let voiceRecordings: any[] = [];
    let videoUrls: string[] = [];
    try {
      voiceRecordings = await prisma.voiceRecording.findMany({
        where: {
          answer: {
            question: {
              sessionId: id
            }
          }
        }
      });
    } catch (err) {
      console.error('Failed to query voice recording files:', err);
    }

    try {
      const answers = await prisma.interviewAnswer.findMany({
        where: {
          question: {
            sessionId: id
          }
        },
        select: {
          videoRecordingUrl: true
        }
      });
      videoUrls = answers
        .map(a => a.videoRecordingUrl)
        .filter((url): url is string => !!url);
    } catch (err) {
      console.error('Failed to query video recording URLs:', err);
    }

    // 2. Run database deletion in transaction
    try {
      await prisma.$transaction(async (tx) => {
        await tx.interviewSession.delete({
          where: { id }
        });
      });
    } catch (txError: any) {
      console.error('Interview session deletion transaction failed:', txError);
      res.status(500).json({ error: 'Unable to complete deletion. No records were removed. Please try again.' });
      return;
    }

    // 3. Delete files from storage only after transaction success
    for (const rec of voiceRecordings) {
      try {
        const fileName = require('path').basename(rec.storagePath);
        await storageService.deleteFile('voice', fileName);
      } catch (err) {
        console.error('Failed to delete voice recording file:', err);
      }
    }

    for (const videoUrl of videoUrls) {
      try {
        const fileName = require('path').basename(videoUrl);
        await storageService.deleteFile('video', fileName);
      } catch (err) {
        console.error('Failed to delete video recording file:', err);
      }
    }

    res.status(200).json({ message: 'Interview session deleted successfully.' });
  } catch (error: any) {
    console.error('Delete interview session error:', error);
    res.status(500).json({ error: 'Unable to complete deletion. No records were removed. Please try again.' });
  }
};

export const bulkDeleteSessions = async (req: any, res: Response): Promise<void> => {
  try {
    const userId = req.user.id;
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids)) {
      res.status(400).json({ error: 'IDs array is required.' });
      return;
    }

    const sessions = await prisma.interviewSession.findMany({
      where: {
        id: { in: ids },
        userId
      },
      select: { id: true }
    });

    const sessionIds = sessions.map(s => s.id);

    if (sessionIds.length === 0) {
      res.status(200).json({ message: 'No matching interview sessions found to delete.', count: 0 });
      return;
    }

    // Query files before deleting records
    let voiceRecordings: any[] = [];
    let videoUrls: string[] = [];

    try {
      voiceRecordings = await prisma.voiceRecording.findMany({
        where: {
          answer: {
            question: {
              sessionId: { in: sessionIds }
            }
          }
        }
      });
    } catch (err) {
      console.error('Failed to query voice recordings in bulk:', err);
    }

    try {
      const answers = await prisma.interviewAnswer.findMany({
        where: {
          question: {
            sessionId: { in: sessionIds }
          }
        },
        select: {
          videoRecordingUrl: true
        }
      });
      videoUrls = answers
        .map(a => a.videoRecordingUrl)
        .filter((url): url is string => !!url);
    } catch (err) {
      console.error('Failed to query video URLs in bulk:', err);
    }

    // Run database deletion in transaction
    try {
      await prisma.$transaction(async (tx) => {
        await tx.interviewSession.deleteMany({
          where: {
            id: { in: sessionIds }
          }
        });
      });
    } catch (txError: any) {
      console.error('Bulk interview session deletion transaction failed:', txError);
      res.status(500).json({ error: 'Unable to complete deletion. No records were removed. Please try again.' });
      return;
    }

    // Delete files after successful database transaction
    for (const rec of voiceRecordings) {
      try {
        const fileName = require('path').basename(rec.storagePath);
        await storageService.deleteFile('voice', fileName);
      } catch (err) {
        console.error('Failed to delete voice recording file in bulk:', err);
      }
    }

    for (const videoUrl of videoUrls) {
      try {
        const fileName = require('path').basename(videoUrl);
        await storageService.deleteFile('video', fileName);
      } catch (err) {
        console.error('Failed to delete video recording file in bulk:', err);
      }
    }

    res.status(200).json({ message: 'Selected interview sessions deleted successfully.', count: sessionIds.length });
  } catch (error: any) {
    console.error('Bulk delete sessions error:', error);
    res.status(500).json({ error: 'Unable to complete deletion. No records were removed. Please try again.' });
  }
};

export const downloadReport = async (req: any, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.params;
    const { format } = req.query;
    const userId = req.user.id;

    const session = await prisma.interviewSession.findFirst({
      where: { id: sessionId, userId },
      include: {
        questions: {
          orderBy: { orderIndex: 'asc' },
          include: { answer: true }
        }
      }
    });

    if (!session) {
      res.status(404).json({ error: 'Interview session not found.' });
      return;
    }

    const { PDFGenerator } = require('../utils/pdfGenerator');
    const { DOCXGenerator } = require('../utils/docxGenerator');

    if (format === 'pdf') {
      const pdfBuffer = await PDFGenerator.generateInterviewReportPDF(session);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=interview_report_${sessionId}.pdf`);
      res.status(200).send(pdfBuffer);
    } else if (format === 'docx') {
      const docxBuffer = await DOCXGenerator.generateInterviewReportDocx(session);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename=interview_report_${sessionId}.docx`);
      res.status(200).send(docxBuffer);
    } else {
      res.status(400).json({ error: 'Invalid format. Use pdf or docx.' });
    }
  } catch (error: any) {
    console.error('Download report error:', error);
    res.status(500).json({ error: error.message || 'Failed to download report.' });
  }
};

export const getPublicReport = async (req: any, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.params;

    const session = await prisma.interviewSession.findUnique({
      where: { id: sessionId },
      include: {
        questions: {
          orderBy: { orderIndex: 'asc' },
          include: { answer: true }
        }
      }
    });

    if (!session) {
      res.status(404).json({ error: 'Interview session report not found.' });
      return;
    }

    res.status(200).json({ session });
  } catch (error: any) {
    console.error('Get public report error:', error);
    res.status(500).json({ error: 'Failed to retrieve public session report.' });
  }
};
