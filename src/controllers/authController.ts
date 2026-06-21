import { Request, Response } from 'express';
import { AuthService } from '../services/authService';
import { prisma } from '../lib/prisma';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import * as path from 'path';
import * as nodemailer from 'nodemailer';
import { StorageService } from '../services/storageService';
import { AIService } from '../services/aiService';

const authService = new AuthService();
const storageService = new StorageService();
const aiService = new AIService();

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, fullName } = req.body;

    if (!email || !password || !fullName) {
      res.status(400).json({ error: 'Email, password, and full name are required.' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Enforce strong password policy: min 8 chars, 1 uppercase, 1 lowercase, 1 digit, 1 special char (!@#$%^&*)
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).{8,}$/;
    if (!passwordRegex.test(password)) {
      res.status(400).json({ error: 'Password does not meet strength requirements.' });
      return;
    }

    const result = await authService.register(normalizedEmail, password, fullName);
    res.status(200).json(result);
  } catch (error: any) {
    console.error('Registration error:', error);
    res.status(400).json({ error: error.message || 'An error occurred during registration.' });
  }
};

export const verifyOtp = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      res.status(400).json({ error: 'Email and verification code are required.' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const result = await authService.verifyOtp(normalizedEmail, code);
    res.status(200).json({
      message: 'Email verified successfully.',
      token: result.token,
      user: {
        id: result.user.id,
        email: result.user.email,
        role: result.user.role,
        theme: result.user.theme,
        fullName: result.user.profile?.fullName || '',
        createdAt: result.user.createdAt,
        lastLogin: result.user.lastLogin
      }
    });
  } catch (error: any) {
    console.error('OTP Verification error:', error);
    res.status(400).json({ error: error.message || 'Verification failed.' });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const result = await authService.login(normalizedEmail, password);

    const userRole = (result.user.role || '').toUpperCase();
    if (role) {
      const requestedRole = role.toUpperCase();
      if (requestedRole === 'ADMIN' && userRole !== 'ADMIN') {
        res.status(403).json({ error: 'Unauthorized Access. This account is not an administrator.' });
        return;
      }
      if (requestedRole === 'STUDENT' && userRole !== 'STUDENT') {
        res.status(403).json({ error: 'Unauthorized Access. This account is not a student.' });
        return;
      }
    }

    res.status(200).json({
      message: 'Login successful.',
      token: result.token,
      user: {
        id: result.user.id,
        email: result.user.email,
        role: result.user.role,
        theme: result.user.theme,
        fullName: result.user.profile?.fullName || '',
        createdAt: result.user.createdAt,
        lastLogin: result.user.lastLogin
      }
    });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(401).json({ error: error.message || 'Authentication failed.' });
  }
};

export const oauthLogin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, fullName, provider } = req.body;

    if (!email || !fullName || !provider) {
      res.status(400).json({ error: 'Email, full name, and provider name are required for OAuth.' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const result = await authService.verifyOAuthUser(normalizedEmail, fullName, provider);
    res.status(200).json({
      message: `${provider} authentication successful.`,
      token: result.token,
      user: {
        id: result.user.id,
        email: result.user.email,
        role: result.user.role,
        theme: result.user.theme,
        fullName: result.user.profile?.fullName || '',
        createdAt: result.user.createdAt,
        lastLogin: result.user.lastLogin
      }
    });
  } catch (error: any) {
    console.error('OAuth Login error:', error);
    res.status(401).json({ error: error.message || 'OAuth authentication failed.' });
  }
};

export const getCurrentUser = async (req: any, res: Response): Promise<void> => {
  try {
    // User is populated via authMiddleware
    res.status(200).json({ user: req.user });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to retrieve active user context.' });
  }
};

export const updateTheme = async (req: any, res: Response): Promise<void> => {
  try {
    const userId = req.user.id;
    const { theme } = req.body;

    if (!theme || !['LIGHT', 'DARK'].includes(theme)) {
      res.status(400).json({ error: 'Valid theme is required (LIGHT or DARK).' });
      return;
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { theme }
    });

    res.status(200).json({
      message: 'Theme updated successfully.',
      theme: updatedUser.theme
    });
  } catch (error: any) {
    console.error('Update theme error:', error);
    res.status(500).json({ error: 'Failed to update theme preference.' });
  }
};

export const getDashboardData = async (req: any, res: Response): Promise<void> => {
  try {
    const userId = req.user.id;

    // Helper to calculate total tasks from a roadmap structure
    const getRoadmapTaskCount = (structureStr: string): number => {
      try {
        const structure = JSON.parse(structureStr);
        const weeks = Array.isArray(structure) ? structure : (structure.weeks || []);
        let count = 0;
        for (const week of weeks) {
          if (Array.isArray(week.topics)) count += week.topics.length;
          if (Array.isArray(week.practiceTasks)) count += week.practiceTasks.length;
          if (Array.isArray(week.courses)) count += week.courses.length;
          if (Array.isArray(week.youtubeResources)) count += week.youtubeResources.length;
          if (week.miniProject && week.miniProject.title) count += 1;
          if (Array.isArray(week.certifications)) count += week.certifications.length;
        }
        return count;
      } catch {
        return 0;
      }
    };

    // 1. Get latest ATS report for the user with its JobProfile & OptimizedResume info
    const latestAtsReportRecord = await prisma.aTSReport.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        jobProfile: true,
        optimizedResume: true
      }
    });

    let latestAtsReport = null;
    let activeJobProfile = null;
    if (latestAtsReportRecord) {
      activeJobProfile = latestAtsReportRecord.jobProfile;

      // Extract filename from resumeUrl (or query ResumeUpload table)
      let resumeName = 'Uploaded Resume';
      if (latestAtsReportRecord.resumeUrl) {
        const matchingUpload = await prisma.resumeUpload.findFirst({
          where: { userId, resumeUrl: latestAtsReportRecord.resumeUrl }
        });
        if (matchingUpload) {
          resumeName = matchingUpload.fileName;
        } else {
          const parts = latestAtsReportRecord.resumeUrl.split('_');
          resumeName = parts[parts.length - 1] || 'Uploaded Resume';
        }
      }

      // Parse scores
      let skillsScore = 0;
      let keywordsScore = 0;
      try {
        const parsedCats = JSON.parse(latestAtsReportRecord.categoryScores);
        skillsScore = parsedCats.skills || 0;
        keywordsScore = parsedCats.keywords || 0;
      } catch {}

      // Count missing skills
      let missingSkillsCount = 0;
      if (activeJobProfile) {
        try {
          const missingArr = JSON.parse(activeJobProfile.missingSkills);
          missingSkillsCount = Array.isArray(missingArr) ? missingArr.length : 0;
        } catch {}
      }

      latestAtsReport = {
        id: latestAtsReportRecord.id,
        jobTitle: latestAtsReportRecord.jobTitle,
        overallScore: latestAtsReportRecord.overallScore,
        createdAt: latestAtsReportRecord.createdAt,
        resumeUrl: latestAtsReportRecord.resumeUrl,
        resumeName,
        skillsScore,
        keywordsScore,
        missingSkillsCount,
        isOptimized: !!latestAtsReportRecord.optimizedResume,
        optimizedResumeId: latestAtsReportRecord.optimizedResume?.id || null
      };
    }

    // 2. Fetch all ATS history & Interview history
    const atsHistoryRecords = await prisma.aTSReport.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' }
    });

    const atsHistory = atsHistoryRecords.map(r => {
      let skillsScore = r.overallScore;
      let keywordsScore = r.overallScore;
      try {
        const cats = JSON.parse(r.categoryScores);
        skillsScore = cats.skills || r.overallScore;
        keywordsScore = cats.keywords || r.overallScore;
      } catch {}
      return {
        id: r.id,
        jobTitle: r.jobTitle,
        overallScore: r.overallScore,
        skillsScore,
        keywordsScore,
        createdAt: r.createdAt
      };
    });

    const interviewHistoryRecords = await prisma.interviewSession.findMany({
      where: { userId, status: 'COMPLETED' },
      orderBy: { createdAt: 'asc' }
    });

    const interviewHistory = interviewHistoryRecords.map(s => ({
      id: s.id,
      role: s.role,
      overallScore: s.overallScore || 0,
      behavioralScore: s.behavioralScore || 0,
      communicationScore: s.communicationScore || 0,
      confidenceScore: s.confidenceScore || 0,
      professionalismScore: s.professionalismScore || 0,
      leadershipPresenceScore: s.leadershipPresenceScore || 0,
      createdAt: s.createdAt
    }));

    // 3. Compute ATS Trend statistics
    const allAtsScores = atsHistory.map(r => r.overallScore);
    const highestAtsScore = allAtsScores.length > 0 ? Math.max(...allAtsScores) : 0;
    const averageAtsScore = allAtsScores.length > 0 ? Math.round(allAtsScores.reduce((a, b) => a + b, 0) / allAtsScores.length) : 0;

    // Find "Most Improved Resume" (max improvement score in OptimizedResumes)
    const optimizedResumes = await prisma.optimizedResume.findMany({
      where: { userId },
      orderBy: { improvement: 'desc' },
      take: 1,
      include: {
        report: true
      }
    });

    const mostImprovedResume = optimizedResumes.length > 0
      ? {
          id: optimizedResumes[0].id,
          jobTitle: optimizedResumes[0].report.jobTitle,
          originalScore: optimizedResumes[0].originalScore,
          optimizedScore: optimizedResumes[0].optimizedScore,
          improvement: optimizedResumes[0].improvement
        }
      : null;

    const atsStats = {
      highestAtsScore,
      averageAtsScore,
      mostImprovedResume
    };

    // 4. Retrieve Active & Completed Roadmaps
    const activeRoadmapsRecords = await prisma.roadmap.findMany({
      where: { userId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' }
    });

    const activeRoadmaps = activeRoadmapsRecords.map(r => {
      const totalTasksCount = getRoadmapTaskCount(r.structure);
      let completedTasksCount = 0;
      try {
        completedTasksCount = r.completedTasks ? JSON.parse(r.completedTasks).length : 0;
      } catch {}
      const tasksRemaining = Math.max(0, totalTasksCount - completedTasksCount);

      // Estimate completion date based on duration
      const completionDate = new Date(r.started_at || r.createdAt);
      completionDate.setDate(completionDate.getDate() + r.durationDays);

      return {
        id: r.id,
        title: r.title,
        progress_percentage: r.progress_percentage || 0.0,
        current_week: r.current_week || 1,
        durationDays: r.durationDays,
        tasksRemaining,
        estimatedCompletionDate: completionDate,
        completedTasksCount,
        totalTasksCount
      };
    });

    const completedRoadmapsRecords = await prisma.roadmap.findMany({
      where: { userId, status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' }
    });

    const completedRoadmaps = completedRoadmapsRecords.map(r => {
      let certs: string[] = [];
      let recommendations: string[] = [];
      try {
        certs = r.certificationsEarned ? JSON.parse(r.certificationsEarned) : [];
      } catch {}
      try {
        recommendations = r.completionRecommendations ? JSON.parse(r.completionRecommendations) : [];
      } catch {}

      return {
        id: r.id,
        title: r.title,
        durationDays: r.durationDays,
        completedAt: r.completedAt || r.createdAt,
        timeSpentLearning: r.timeSpentLearning || 0,
        certificationsEarned: certs,
        finalAssessment: r.finalAssessment || 'Roadmap completed successfully.',
        completionRecommendations: recommendations
      };
    });

    // 5. Gather Recent Activity list chronologically
    const activities: Array<{ type: string; title: string; date: Date; details: string }> = [];

    // Add Resume Analyses
    for (const r of atsHistoryRecords.slice(-5)) {
      activities.push({
        type: 'ATS_ANALYSIS',
        title: `Resume analyzed for "${r.jobTitle}"`,
        date: r.createdAt,
        details: `ATS Suitability Score: ${r.overallScore}%`
      });
    }

    // Add Mock Interviews
    const allInterviews = await prisma.interviewSession.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 5
    });
    for (const s of allInterviews) {
      activities.push({
        type: 'MOCK_INTERVIEW',
        title: `${s.role} AI Mock Interview`,
        date: s.createdAt,
        details: s.status === 'COMPLETED' ? `Overall Performance: ${s.overallScore}%` : 'Practice session started'
      });
    }

    // Add Roadmaps Generated
    const allRoadmaps = await prisma.roadmap.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 5
    });
    for (const rm of allRoadmaps) {
      activities.push({
        type: rm.status === 'COMPLETED' ? 'COMPLETED_ROADMAP' : 'ROADMAP_GENERATION',
        title: rm.status === 'COMPLETED' ? `Completed roadmap: "${rm.title}"` : `Roadmap generated: "${rm.title}"`,
        date: rm.completedAt || rm.createdAt,
        details: rm.status === 'COMPLETED'
          ? `Spent ${rm.timeSpentLearning} learning hours`
          : `Duration: ${rm.durationDays} days`
      });
    }

    const recentActivity = activities
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, 10);

    // 6. Gather Skill Gap & AI Recommendations
    let topMissingSkills: string[] = [];
    if (activeJobProfile) {
      try {
        const skillsArr = JSON.parse(activeJobProfile.missingSkills);
        topMissingSkills = Array.isArray(skillsArr)
          ? skillsArr.map((s: any) => typeof s === 'string' ? s : (s.skill || ''))
          : [];
      } catch {}
    }

    // Call AI to generate dashboard recommendations
    const jobTitle = activeJobProfile?.jobTitle || 'Software Engineer';
    const experienceLevel = activeJobProfile?.experienceLevel || 'Fresher';
    const recommendedNextSteps = await aiService.generateDashboardRecommendations(
      jobTitle,
      experienceLevel,
      topMissingSkills,
      interviewHistory,
      allRoadmaps,
      latestAtsReport,
      activeJobProfile
    );

    // 7. General Preparation KPI counts
    const completedInterviewsCount = interviewHistoryRecords.length;
    const avgInterviewScore = completedInterviewsCount > 0
      ? Math.round(interviewHistoryRecords.reduce((acc, curr) => acc + (curr.overallScore || 0), 0) / completedInterviewsCount)
      : 0;

    const resumeUploadCount = await prisma.resumeUpload.count({ where: { userId } });
    const resumeCount = await prisma.aTSReport.count({ where: { userId } });
    const roadmapCount = await prisma.roadmap.count({ where: { userId } });

    // Compute Latest Interview Stats
    let latestInterviewStats = null;
    if (interviewHistoryRecords.length > 0) {
      const latestSession = interviewHistoryRecords[interviewHistoryRecords.length - 1];
      let improvement = 0;
      if (interviewHistoryRecords.length > 1) {
        const prevSession = interviewHistoryRecords[interviewHistoryRecords.length - 2];
        improvement = (latestSession.overallScore || 0) - (prevSession.overallScore || 0);
      }
      latestInterviewStats = {
        overallScore: latestSession.overallScore || 0,
        behavioralScore: latestSession.behavioralScore || 0,
        communicationScore: latestSession.communicationScore || 0,
        confidenceScore: latestSession.confidenceScore || 0,
        professionalismScore: latestSession.professionalismScore || 0,
        improvement
      };
    }

    res.status(200).json({
      stats: {
        atsScore: latestAtsReport ? latestAtsReport.overallScore : 0,
        totalInterviews: completedInterviewsCount,
        avgInterviewScore,
        skillMatch: latestAtsReport ? latestAtsReport.skillsScore : 0,
        keywordMatch: latestAtsReport ? latestAtsReport.keywordsScore : 0,
        resumeCount,
        roadmapCount,
        resumeUploadCount
      },
      latestAtsReport,
      activeJobProfile,
      atsStats,
      atsHistory,
      interviewHistory,
      recentActivity,
      skillGap: {
        topMissingSkills: topMissingSkills.slice(0, 8),
        recommendedNextSteps
      },
      activeRoadmaps,
      completedRoadmaps,
      latestInterviewStats
    });
  } catch (error: any) {
    console.error('Failed to get dashboard statistics:', error);
    res.status(500).json({ error: 'Failed to retrieve dashboard statistics.' });
  }
};

export const updateProfile = async (req: any, res: Response): Promise<void> => {
  try {
    const userId = req.user.id;
    const { fullName, email, avatarUrl } = req.body;

    if (!fullName || !email) {
      res.status(400).json({ error: 'Full name and email are required.' });
      return;
    }

    if (email !== req.user.email) {
      const emailTaken = await prisma.user.findFirst({
        where: {
          email,
          id: { not: userId }
        }
      });
      if (emailTaken) {
        res.status(400).json({ error: 'Email address is already in use.' });
        return;
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        email,
        profile: {
          upsert: {
            create: {
              fullName,
              avatarUrl,
              experienceLevel: 'Fresher',
              currentRole: 'Student'
            },
            update: {
              fullName,
              avatarUrl
            }
          }
        }
      },
      include: { profile: true }
    });

    res.status(200).json({
      message: 'Profile updated successfully.',
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        role: updatedUser.role,
        theme: updatedUser.theme,
        fullName: updatedUser.profile?.fullName || '',
        avatarUrl: updatedUser.profile?.avatarUrl || '',
        createdAt: updatedUser.createdAt,
        lastLogin: updatedUser.lastLogin,
        hasPassword: !!updatedUser.passwordHash
      }
    });
  } catch (error: any) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile settings.' });
  }
};

export const uploadAvatar = async (req: any, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No avatar file uploaded.' });
      return;
    }
    const file = req.file;
    const fileName = `avatar-${req.user.id}-${Date.now()}${path.extname(file.originalname)}`;
    const avatarUrl = await storageService.uploadFile('avatars', fileName, file.buffer, file.mimetype);
    res.status(200).json({ avatarUrl });
  } catch (error: any) {
    console.error('Avatar upload failed:', error);
    res.status(500).json({ error: 'Failed to upload profile picture.' });
  }
};

export const changePassword = async (req: any, res: Response): Promise<void> => {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Current password and new password are required.' });
      return;
    }

    if (currentPassword === newPassword) {
      res.status(400).json({ error: 'New password cannot be the same as your current password. Please choose a different password.' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    if (user.passwordHash) {
      const isValid = bcrypt.compareSync(currentPassword, user.passwordHash);
      if (!isValid) {
        res.status(400).json({ error: 'Incorrect current password.' });
        return;
      }
    }

    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      res.status(400).json({ error: 'New password does not meet strength requirements.' });
      return;
    }

    const passwordHash = bcrypt.hashSync(newPassword, 10);

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash }
    });

    if (authService['supabaseAdmin']) {
      try {
        const { data: { users } } = await authService['supabaseAdmin'].auth.admin.listUsers();
        const target = users?.find(u => u.email === user.email);
        if (target) {
          await authService['supabaseAdmin'].auth.admin.updateUserById(target.id, { password: newPassword });
        }
      } catch (err) {
        console.error('Failed to sync updated password to Supabase Auth:', err);
      }
    }

    res.status(200).json({ message: 'Password updated successfully.' });
  } catch (error: any) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Failed to update password.' });
  }
};

export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ error: 'Email address is required.' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Enforce "Email not registered" check
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: { profile: true }
    });
    if (!user) {
      res.status(400).json({ error: 'Email not registered.' });
      return;
    }

    // Generate a secure 6-digit numeric reset token code (extremely easy to type on mobile/tablet)
    const resetToken = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes expiration

    // Store in database
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: resetToken,
        passwordResetExpires: expires
      }
    });

    const userName = user.profile?.fullName || 'User';
    const clientOrigin = req.body.origin || process.env.FRONTEND_URL || 'http://localhost:3000';
    const resetLink = `${clientOrigin}/reset-password?token=${resetToken}`;

    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT;
    const userMail = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM || 'no-reply@novahire.com';

    // Exact template requested with code fallback
    const emailContent = `Hello ${userName},
We received a request to reset your password.
Click the link below to create a new password:
${resetLink}
Or use this secure reset code: ${resetToken}
This link and code expire in 15 minutes.
If you did not request this change, please ignore this email.
Regards,
Team`;

    const emailHtml = `Hello ${userName},<br/><br/>
We received a request to reset your password.<br/>
Click the button below to create a new password:<br/><br/>
<a href="${resetLink}" style="display: inline-block; background-color: #7C3AED; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; font-family: Arial, sans-serif; font-size: 14px; text-align: center;">Reset Password</a><br/><br/>
Or enter this reset code manually on the reset page: <strong>${resetToken}</strong><br/><br/>
This link and code expire in 15 minutes.<br/>
If you did not request this change, please ignore this email.<br/><br/>
Regards,<br/>
Team`;

    if (host && userMail && pass) {
      const transporter = nodemailer.createTransport({
        host,
        port: parseInt(port || '587'),
        secure: port === '465',
        auth: { user: userMail, pass }
      });
      await transporter.sendMail({
        from: `"NovaHire AI" <${from}>`,
        to: normalizedEmail,
        subject: 'Reset Your Password - NovaHire AI',
        text: emailContent,
        html: emailHtml
      });
      console.log(`Successfully sent reset link directly via SMTP to ${normalizedEmail}`);
    } else {
      console.log(`[LOCAL DEV MAIL] Password Reset Link: ${resetLink}`);
    }

    res.status(200).json({ message: 'Password reset email sent successfully. Please check your inbox and spam folder.' });
  } catch (error: any) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: error.message || 'An error occurred while initiating password reset.' });
  }
};

export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      res.status(400).json({ error: 'Token and new password are required.' });
      return;
    }

    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).{8,}$/;
    if (!passwordRegex.test(password)) {
      res.status(400).json({ error: 'Password does not meet strength requirements.' });
      return;
    }

    // Lookup user by token and expiration
    const user = await prisma.user.findFirst({
      where: {
        passwordResetToken: token,
        passwordResetExpires: {
          gt: new Date()
        }
      }
    });

    if (!user) {
      res.status(400).json({ error: 'Invalid or expired password reset token.' });
      return;
    }

    const passwordHash = bcrypt.hashSync(password, 10);

    // Save hashed password and clear token/expiration
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordResetToken: null,
        passwordResetExpires: null
      }
    });

    if (authService['supabaseAdmin']) {
      try {
        const { data: { users } } = await authService['supabaseAdmin'].auth.admin.listUsers();
        const target = users?.find(u => u.email === user.email);
        if (target) {
          await authService['supabaseAdmin'].auth.admin.updateUserById(target.id, { password });
        }
      } catch (err) {
        console.error('Failed to sync reset password to Supabase Auth:', err);
      }
    }

    res.status(200).json({ message: 'Password updated successfully.' });
  } catch (error: any) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password.' });
  }
};


export const deleteAccount = async (req: any, res: Response): Promise<void> => {
  try {
    const userId = req.user.id;
    const { password } = req.body;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true }
    });

    if (!user) {
      res.status(404).json({ error: 'User account not found.' });
      return;
    }

    if (user.passwordHash) {
      if (!password) {
        res.status(400).json({ error: 'Password confirmation is required to delete your account.' });
        return;
      }
      const isValid = bcrypt.compareSync(password, user.passwordHash);
      if (!isValid) {
        res.status(400).json({ error: 'Incorrect confirmation password.' });
        return;
      }
    }

    // 1. Storage cleanup - files deleted first
    try {
      const voiceRecordings = await prisma.voiceRecording.findMany({
        where: {
          answer: {
            userId: userId
          }
        }
      });
      for (const rec of voiceRecordings) {
        await storageService.deleteFile('voice', rec.storagePath);
      }
    } catch (err) {
      console.error('Failed to clean up voice recordings:', err);
    }

    try {
      const atsReports = await prisma.aTSReport.findMany({
        where: { userId },
        select: { resumeUrl: true }
      });
      for (const report of atsReports) {
        if (report.resumeUrl) {
          const fileName = path.basename(report.resumeUrl);
          await storageService.deleteFile('resumes', fileName);
        }
      }
    } catch (err) {
      console.error('Failed to clean up resume files:', err);
    }

    if (user.profile?.avatarUrl) {
      try {
        const fileName = path.basename(user.profile.avatarUrl);
        await storageService.deleteFile('avatars', fileName);
      } catch (err) {
        console.error('Failed to clean up avatar:', err);
      }
    }

    // 2. Delete Supabase Auth user
    let supabaseDeleted = false;
    if (authService['supabaseAdmin']) {
      try {
        const { data: { users } } = await authService['supabaseAdmin'].auth.admin.listUsers();
        const target = users?.find(u => u.email === user.email);
        if (target) {
          await authService['supabaseAdmin'].auth.admin.deleteUser(target.id);
          console.log(`Deleted Supabase Auth user via Admin API: ${target.id}`);
          supabaseDeleted = true;
        }
      } catch (err) {
        console.error('Failed to delete Supabase Auth user record via Admin API:', err);
      }
    }

    // Direct database fallback for Supabase Auth (when service role key is missing/restricted)
    if (!supabaseDeleted) {
      try {
        const result = await prisma.$executeRawUnsafe(
          `DELETE FROM auth.users WHERE email = $1`,
          user.email
        );
        console.log('Deleted Supabase Auth user via direct SQL query, rows affected:', result);
      } catch (err) {
        console.error('Failed to delete Supabase Auth user record via direct SQL query:', err);
      }
    }

    // 3. Delete Prisma database user (cascades)
    await prisma.user.delete({
      where: { id: userId }
    });

    res.status(200).json({ message: 'Account deleted successfully.' });
  } catch (error: any) {
    console.error('Delete account error:', error);
    res.status(500).json({ error: 'Failed to delete user account.' });
  }
};

export const clearAllHistory = async (req: any, res: Response): Promise<void> => {
  try {
    const userId = req.user.id;

    // 1. Clean up voice files
    try {
      const voiceRecordings = await prisma.voiceRecording.findMany({
        where: {
          answer: {
            userId: userId
          }
        }
      });
      for (const rec of voiceRecordings) {
        await storageService.deleteFile('voice', rec.storagePath);
      }
    } catch (err) {
      console.error('Failed to clear voice recording files:', err);
    }

    // 2. Clean up resumes (from resumeUploads table to capture all uploads)
    try {
      const resumeUploads = await prisma.resumeUpload.findMany({
        where: { userId },
        select: { resumeUrl: true }
      });
      for (const upload of resumeUploads) {
        if (upload.resumeUrl) {
          const fileName = path.basename(upload.resumeUrl);
          await storageService.deleteFile('resumes', fileName);
        }
      }
    } catch (err) {
      console.error('Failed to clear resume files:', err);
    }

    // 3. Clear database records
    await prisma.$transaction([
      prisma.resumeUpload.deleteMany({ where: { userId } }),
      prisma.aTSReport.deleteMany({ where: { userId } }),
      prisma.skillGapReport.deleteMany({ where: { userId } }),
      prisma.roadmap.deleteMany({ where: { userId } }),
      prisma.interviewSession.deleteMany({ where: { userId } }),
      prisma.jobProfile.deleteMany({ where: { userId } })
    ]);

    res.status(200).json({ message: 'All preparation history cleared successfully.' });
  } catch (error: any) {
    console.error('Clear history error:', error);
    res.status(500).json({ error: 'Failed to clear preparation history.' });
  }
};

