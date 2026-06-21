import request from 'supertest';
import app from '../index';
import { prisma } from '../lib/prisma';

const testEmail = 'roadmap.tester@university.edu';
const testPassword = 'TesterPassword123!';

describe('Roadmap Lifecycle and Progress API Tests', () => {
  jest.setTimeout(30000);
  let token = '';
  let userId = '';
  let roadmapId = '';

  beforeAll(async () => {
    // 1. Clean up existing users
    await prisma.user.deleteMany({ where: { email: testEmail } });

    // 2. Register a new user
    const regRes = await request(app).post('/api/auth/register').send({
      email: testEmail,
      password: testPassword,
      fullName: 'Roadmap Tester'
    });

    const match = regRes.body.message ? regRes.body.message.match(/OTP: (\d{6})/) : null;
    const otpCode = match ? match[1] : '123456';

    // 3. Verify OTP
    const verifyRes = await request(app).post('/api/auth/verify-otp').send({
      email: testEmail,
      code: otpCode
    });

    token = verifyRes.body.token || '';
    
    // Find the user id
    const user = await prisma.user.findUnique({
      where: { email: testEmail }
    });
    if (user) {
      userId = user.id;

      // Create a dummy ATSReport so we have a target resume text
      await prisma.aTSReport.create({
        data: {
          userId: user.id,
          resumeText: 'John Doe\njohn@example.com\n\n[Experience]\nSoftware Engineer at Tech Corp\n\n[Projects]\nOld Project 1\n- Built a simple web server\n',
          overallScore: 70,
          jobTitle: 'Software Engineer',
          jobDescription: 'Required React and TypeScript skills',
          categoryScores: '{}',
          strengths: '[]',
          weaknesses: '[]',
          missingKeywords: '[]',
          recommendations: '[]'
        }
      });
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: testEmail } });
    await prisma.$disconnect();
  });

  test('Should manually seed a dummy roadmap for testing progress', async () => {
    expect(userId).toBeDefined();
    expect(userId.length).toBeGreaterThan(0);

    // Create a mock structure containing 3 checkable tasks: 2 practice tasks, 1 mini project
    const structure = JSON.stringify([
      {
        week: 1,
        title: 'Week 1 Test',
        topics: ['Master TypeScript Basics'],
        practiceTasks: ['Build a calculator', 'Implement search algorithm'],
        miniProject: {
          title: 'Project Alpha',
          description: 'A nice project description'
        }
      }
    ]);

    const roadmap = await prisma.roadmap.create({
      data: {
        userId,
        title: 'Test Roadmap',
        durationDays: 7,
        structure,
        status: 'ACTIVE',
        is_active: true
      }
    });

    roadmapId = roadmap.id;
    expect(roadmapId).toBeDefined();
  });

  test('PUT /api/roadmap/:id/progress -> Should update partial progress and stay ACTIVE', async () => {
    if (!token || !roadmapId) {
      fail('Token or roadmapId was not set successfully');
    }

    // We have 3 checkable tasks. Let's check 1 task: `pt_0` (itemId format is `pt_0` under week 1)
    // The key generated is `${roadmapId}_w1_pt_0`
    const checkedItems = [`${roadmapId}_w1_pt_0`];

    const res = await request(app)
      .put(`/api/roadmap/${roadmapId}/progress`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        checkedItems,
        timeSpentLearning: 3,
        currentWeek: 1
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.roadmap.progress_percentage).toBe(33.3);
    expect(res.body.roadmap.status).toBe('ACTIVE');
    expect(res.body.roadmap.timeSpentLearning).toBe(3);
  });

  test('PUT /api/roadmap/:id/status -> Should toggle to INACTIVE', async () => {
    if (!token || !roadmapId) {
      fail('Token or roadmapId was not set successfully');
    }

    const res = await request(app)
      .put(`/api/roadmap/${roadmapId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'INACTIVE' });

    expect(res.statusCode).toBe(200);
    expect(res.body.roadmap.status).toBe('INACTIVE');
    expect(res.body.roadmap.is_active).toBe(false);
  });

  test('PUT /api/roadmap/:id/status -> Should toggle to ARCHIVED', async () => {
    if (!token || !roadmapId) {
      fail('Token or roadmapId was not set successfully');
    }

    const res = await request(app)
      .put(`/api/roadmap/${roadmapId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ARCHIVED' });

    expect(res.statusCode).toBe(200);
    expect(res.body.roadmap.status).toBe('ARCHIVED');
    expect(res.body.roadmap.is_active).toBe(false);
  });

  test('PUT /api/roadmap/:id/progress -> Should reject updates when ARCHIVED', async () => {
    if (!token || !roadmapId) {
      fail('Token or roadmapId was not set successfully');
    }

    const res = await request(app)
      .put(`/api/roadmap/${roadmapId}/progress`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        checkedItems: [`${roadmapId}_w1_pt_0`],
        timeSpentLearning: 1
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('read-only');
  });

  test('PUT /api/roadmap/:id/status -> Should toggle back to ACTIVE', async () => {
    if (!token || !roadmapId) {
      fail('Token or roadmapId was not set successfully');
    }

    const res = await request(app)
      .put(`/api/roadmap/${roadmapId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ACTIVE' });

    expect(res.statusCode).toBe(200);
    expect(res.body.roadmap.status).toBe('ACTIVE');
    expect(res.body.roadmap.is_active).toBe(true);
  });

  test('PUT /api/roadmap/:id/progress -> Should complete the roadmap at 100% progress', async () => {
    if (!token || !roadmapId) {
      fail('Token or roadmapId was not set successfully');
    }

    // Check all 3 checkable tasks: `pt_0`, `pt_1`, `project`
    const checkedItems = [
      `${roadmapId}_w1_pt_0`,
      `${roadmapId}_w1_pt_1`,
      `${roadmapId}_w1_project`
    ];

    const res = await request(app)
      .put(`/api/roadmap/${roadmapId}/progress`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        checkedItems,
        timeSpentLearning: 5
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.roadmap.progress_percentage).toBe(100.0);
    expect(res.body.roadmap.status).toBe('COMPLETED');
    expect(res.body.roadmap.completedAt).toBeDefined();
    expect(res.body.roadmap.finalAssessment).toBeDefined();
    expect(res.body.roadmap.completionRecommendations).toBeDefined();
  });

  test('PUT /api/roadmap/:id/progress -> Should move back to ACTIVE if progress drops below 100%', async () => {
    if (!token || !roadmapId) {
      fail('Token or roadmapId was not set successfully');
    }

    // Uncheck one task
    const checkedItems = [
      `${roadmapId}_w1_pt_0`,
      `${roadmapId}_w1_pt_1`
    ];

    const res = await request(app)
      .put(`/api/roadmap/${roadmapId}/progress`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        checkedItems,
        timeSpentLearning: 0
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.roadmap.progress_percentage).toBe(66.7);
    expect(res.body.roadmap.status).toBe('ACTIVE');
    expect(res.body.roadmap.completedAt).toBeNull();
    expect(res.body.roadmap.finalAssessment).toBeNull();
    expect(res.body.roadmap.completionRecommendations).toBeNull();
  });

  test('GET /api/roadmap/:id/topics/:topicName -> Should return topic explanation', async () => {
    if (!token || !roadmapId) {
      fail('Token or roadmapId was not set successfully');
    }

    const res = await request(app)
      .get(`/api/roadmap/${roadmapId}/topics/TypeScript%20Generics`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.explanation).toBeDefined();
    expect(res.body.explanation.definition).toBeDefined();
  });

  test('POST /api/roadmap/:id/projects/:week/submit -> Should reject missing/invalid URLs', async () => {
    if (!token || !roadmapId) {
      fail('Token or roadmapId was not set successfully');
    }

    // Missing URLs
    const res1 = await request(app)
      .post(`/api/roadmap/${roadmapId}/projects/1/submit`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res1.statusCode).toBe(400);

    // Invalid URLs
    const res2 = await request(app)
      .post(`/api/roadmap/${roadmapId}/projects/1/submit`)
      .set('Authorization', `Bearer ${token}`)
      .send({ githubUrl: 'not-a-url', deploymentUrl: 'not-a-url' });
    expect(res2.statusCode).toBe(400);
  });

  test('POST /api/roadmap/:id/projects/:week/submit -> Should submit project successfully for live URLs', async () => {
    if (!token || !roadmapId) {
      fail('Token or roadmapId was not set successfully');
    }

    const res = await request(app)
      .post(`/api/roadmap/${roadmapId}/projects/1/submit`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        githubUrl: 'https://github.com',
        deploymentUrl: 'https://google.com'
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.submission).toBeDefined();
    expect(res.body.submission.evaluation).toBeDefined();
    expect(res.body.submission.evaluation.score).toBeGreaterThanOrEqual(0);
  });

  test('POST /api/roadmap/:id/projects/:week/add-to-resume -> Should inject project into resume text', async () => {
    if (!token || !roadmapId) {
      fail('Token or roadmapId was not set successfully');
    }

    const res = await request(app)
      .post(`/api/roadmap/${roadmapId}/projects/1/add-to-resume`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.statusCode).toBe(200);
    expect(res.body.updatedResumeText).toContain('Project Alpha');
  });
});
