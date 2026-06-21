import request from 'supertest';
import app from '../index';
import { prisma } from '../lib/prisma';

const testEmail = 'test.settings@university.edu';
const updatedEmail = 'test.settings-updated@university.edu';
const testPassword = 'SecurePassword123!';
const newPassword = 'NewSecurePassword456!';
const weakPassword = 'weak';
const testName = 'Settings Student';
const updatedName = 'Settings Student Updated';

describe('Account Management, Password Recovery, and Deletion Integration Tests', () => {
  let token = '';
  let userId = '';
  let otpCode = '';
  let resetToken = '';

  beforeAll(async () => {
    // Clean up any existing test records
    await prisma.user.deleteMany({
      where: { email: { in: [testEmail, updatedEmail] } }
    });
  });

  afterAll(async () => {
    // Clean up database records and disconnect
    await prisma.user.deleteMany({
      where: { email: { in: [testEmail, updatedEmail] } }
    });
    await prisma.$disconnect();
  });

  // Step 1: Register and activate test user
  test('Register new test user', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: testEmail,
        password: testPassword,
        fullName: testName
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.requiresOtp).toBe(true);

    const match = res.body.message.match(/OTP: (\d{6})/);
    otpCode = match ? match[1] : '123456';
  });

  test('Verify OTP and save authentication token', async () => {
    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({
        email: testEmail,
        code: otpCode
      });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('token');
    token = res.body.token;
    userId = res.body.user.id;
  });

  // Step 2: Test Profile Update
  test('PUT /api/auth/profile -> Should update full name and email', async () => {
    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fullName: updatedName,
        email: updatedEmail
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.user.fullName).toBe(updatedName);
    expect(res.body.user.email).toBe(updatedEmail);
    expect(res.body.user).toHaveProperty('lastLogin');
  });

  // Step 3: Test Change Password strength validations and current password checking
  test('PUT /api/auth/change-password -> Should validate current password', async () => {
    const res = await request(app)
      .put('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({
        currentPassword: 'IncorrectPassword',
        newPassword: newPassword
      });

    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toContain('Incorrect');
  });

  test('PUT /api/auth/change-password -> Should block weak new passwords', async () => {
    const res = await request(app)
      .put('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({
        currentPassword: testPassword,
        newPassword: weakPassword
      });

    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toContain('strength');
  });

  test('PUT /api/auth/change-password -> Should update password successfully', async () => {
    const res = await request(app)
      .put('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({
        currentPassword: testPassword,
        newPassword: newPassword
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toContain('successfully');
  });

  // Step 4: Test Forgot and Reset password
  test('POST /api/auth/forgot-password -> Should send reset token link', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({
        email: updatedEmail
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toContain('sent');
  });

  test('POST /api/auth/reset-password -> Should update password with recovery token', async () => {
    const userInDb = await prisma.user.findUnique({
      where: { email: updatedEmail }
    });
    const dbResetToken = userInDb?.passwordResetToken || '';

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({
        token: dbResetToken,
        password: testPassword
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toContain('successfully');
  });

  // Step 5: Test History Deletion individual and bulk delete routes
  test('Verify single record deletions', async () => {
    // 1. Create a mock ATS report
    const jobProfile = await prisma.jobProfile.create({
      data: {
        userId,
        jobTitle: 'Software Engineer',
        jobDescription: 'Node.js developer',
        extractedSkills: '[]',
        missingSkills: '[]',
        matchingSkills: '[]',
        experienceLevel: 'Fresher',
        domainClassification: 'Backend',
        atsKeywords: '[]',
        targetRoleProfile: '{}'
      }
    });

    const report = await prisma.aTSReport.create({
      data: {
        userId,
        jobProfileId: jobProfile.id,
        jobTitle: 'Software Engineer',
        jobDescription: 'Node.js developer',
        overallScore: 85,
        categoryScores: '{}',
        strengths: '[]',
        weaknesses: '[]',
        missingKeywords: '[]',
        recommendations: '[]',
        resumeUrl: 'http://localhost:8000/uploads/resumes/mock.pdf'
      }
    });

    // 2. Try deleting the report
    const delRes = await request(app)
      .delete(`/api/ats/reports/${report.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(delRes.statusCode).toBe(200);

    const checkReport = await prisma.aTSReport.findUnique({ where: { id: report.id } });
    expect(checkReport).toBeNull();
  });

  test('Verify clear all history record cascading deletions', async () => {
    // Create mock resume upload
    await prisma.resumeUpload.create({
      data: {
        userId,
        resumeUrl: 'http://localhost:8000/uploads/resumes/mock_upload.pdf',
        fileName: 'mock_upload.pdf'
      }
    });

    // Create mock roadmap
    await prisma.roadmap.create({
      data: {
        userId,
        title: 'Software Developer Pathway',
        durationDays: 30,
        structure: '[]'
      }
    });

    // Verify initial counts
    const initialResumeUploads = await prisma.resumeUpload.count({ where: { userId } });
    expect(initialResumeUploads).toBe(1);

    // Clear all history
    const clearRes = await request(app)
      .delete('/api/auth/clear-all-history')
      .set('Authorization', `Bearer ${token}`);

    expect(clearRes.statusCode).toBe(200);

    const roadmapsCount = await prisma.roadmap.count({ where: { userId } });
    expect(roadmapsCount).toBe(0);

    const resumeUploadsCount = await prisma.resumeUpload.count({ where: { userId } });
    expect(resumeUploadsCount).toBe(0);
  });

  // Step 6: Test Account Deletion cascading DB deletion
  test('DELETE /api/auth/delete-account -> Should require password confirmation', async () => {
    const res = await request(app)
      .delete('/api/auth/delete-account')
      .set('Authorization', `Bearer ${token}`)
      .send({
        password: 'IncorrectPassword'
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('Incorrect');
  });

  test('DELETE /api/auth/delete-account -> Should delete user and all cascade data', async () => {
    const res = await request(app)
      .delete('/api/auth/delete-account')
      .set('Authorization', `Bearer ${token}`)
      .send({
        password: testPassword // Reset earlier back to testPassword
      });

    expect(res.statusCode).toBe(200);

    // Verify user no longer exists in DB
    const checkUser = await prisma.user.findUnique({ where: { id: userId } });
    expect(checkUser).toBeNull();

    // Verify profile is cascadingly deleted
    const checkProfile = await prisma.profile.findUnique({ where: { userId } });
    expect(checkProfile).toBeNull();
  });
});
