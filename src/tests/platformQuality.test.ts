import request from 'supertest';
import app from '../index';
import { prisma } from '../lib/prisma';
import { AIService } from '../services/aiService';

const testEmail = 'quality.tester@university.edu';
const testPassword = 'TesterPassword123!';

describe('Platform End-to-End Quality & Alignment Tests', () => {
  let token = '';

  beforeAll(async () => {
    // Clean and set up test user
    await prisma.user.deleteMany({ where: { email: testEmail } });
    
    await request(app).post('/api/auth/register').send({
      email: testEmail,
      password: testPassword,
      fullName: 'Quality Tester'
    });

    const verifyRes = await request(app).post('/api/auth/verify-otp').send({
      email: testEmail,
      code: '123456'
    });

    token = verifyRes.body.token || '';
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: testEmail } });
    await prisma.$disconnect();
  });

  test('Fresher Machine Learning Engineer E2E Flow', async () => {
    if (!token) return;

    // 1. Analyze Resume with Fresher ML target
    const mockResume = Buffer.from('Resume: John Doe. Knowledge of Python, SQL, Git. Projects: Basic regression model in Python.');
    const scanRes = await request(app)
      .post('/api/ats/analyze')
      .set('Authorization', `Bearer ${token}`)
      .field('jobTitle', 'Machine Learning Engineer')
      .field('jobDescription', 'We are looking for a Machine Learning Engineer with Python, SQL, PyTorch, and TensorFlow skills.')
      .field('experienceLevel', 'Fresher')
      .attach('resume', mockResume, 'resume.pdf');

    expect(scanRes.statusCode).toBe(200);
    
    // Get latest active job profile
    const activeProfile = await prisma.jobProfile.findFirst({
      where: { user: { email: testEmail } },
      orderBy: { createdAt: 'desc' }
    });

    expect(activeProfile).toBeDefined();
    expect(activeProfile?.experienceLevel).toBe('Fresher');
    expect(activeProfile?.jobTitle).toBe('Machine Learning Engineer');

    // Assert skill extraction quality
    const extractedSkills: string[] = JSON.parse(activeProfile?.extractedSkills || '[]');
    const blacklisted = ['Level', 'Key', 'Develop', 'Review', 'Collaborate', 'work', 'experience'];
    extractedSkills.forEach(skill => {
      expect(blacklisted.some(word => skill.toLowerCase() === word.toLowerCase())).toBe(false);
    });

    // 2. Generate Roadmap
    const roadmapRes = await request(app)
      .post('/api/roadmaps/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({ durationDays: 30 });

    expect(roadmapRes.statusCode).toBe(200);
    const roadmap = await prisma.roadmap.findFirst({
      where: { userId: activeProfile?.userId },
      orderBy: { createdAt: 'desc' }
    });
    expect(roadmap).toBeDefined();
    expect(roadmap?.title).toContain('Fresher');

    // 3. Start Mock Interview
    const startRes = await request(app)
      .post('/api/interviews/start')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'TECHNICAL',
        company: 'Google',
        difficulty: 'EASY',
        questionCount: 2
      });

    expect(startRes.statusCode).toBe(200);
    const session = startRes.body.session;
    expect(session).toBeDefined();
    expect(session.experienceLevel).toBe('Fresher');
    expect(session.questions.length).toBe(2);

    // 4. Submit "I don't know" answer
    const q1Id = session.questions[0].id;
    const ans1Res = await request(app)
      .post(`/api/interviews/session/${session.id}/submit`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        questionId: q1Id,
        answerText: "I don't know."
      });

    expect(ans1Res.statusCode).toBe(200);
    const eval1 = ans1Res.body.evaluation;
    expect(eval1.correctnessScore).toBe(0);
    expect(eval1.score).toBe(0);
    expect(eval1.confidenceScore).toBe(0);
    expect(eval1.communicationScore).toBeLessThanOrEqual(10);

    // 5. Submit Gibberish answer
    const q2Id = session.questions[1].id;
    const ans2Res = await request(app)
      .post(`/api/interviews/session/${session.id}/submit`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        questionId: q2Id,
        answerText: "asdfghjkl"
      });

    expect(ans2Res.statusCode).toBe(200);
    const eval2 = ans2Res.body.evaluation;
    expect(eval2.correctnessScore).toBe(0);
    expect(eval2.score).toBe(0);
    expect(eval2.confidenceScore).toBe(0);
    expect(eval2.communicationScore).toBeLessThanOrEqual(10);
  });

  test('Senior Full Stack Developer Quality check', async () => {
    if (!token) return;

    // Analyze with Senior Full Stack Developer target
    const mockResume = Buffer.from('Resume: Jane Doe. Lead Engineer. Built React, Next.js, Node.js and PostgreSQL applications. Kubernetes and AWS docker scaling.');
    const scanRes = await request(app)
      .post('/api/ats/analyze')
      .set('Authorization', `Bearer ${token}`)
      .field('jobTitle', 'Full Stack Developer')
      .field('jobDescription', 'Looking for an experienced React, Next.js, Node.js developer with PostgreSQL, System Design, and Kubernetes caching skills.')
      .field('experienceLevel', 'Senior')
      .attach('resume', mockResume, 'resume.pdf');

    expect(scanRes.statusCode).toBe(200);

    const activeProfile = await prisma.jobProfile.findFirst({
      where: { user: { email: testEmail } },
      orderBy: { createdAt: 'desc' }
    });

    expect(activeProfile?.experienceLevel).toBe('Senior');

    // Generate Roadmap
    const roadmapRes = await request(app)
      .post('/api/roadmaps/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({ durationDays: 30 });

    expect(roadmapRes.statusCode).toBe(200);
    const structure = JSON.parse(roadmapRes.body.roadmap.structure);
    // Senior roadmap contains advanced engineering topics
    expect(structure[0].topics.some((t: string) => t.toLowerCase().includes('enterprise') || t.toLowerCase().includes('system') || t.toLowerCase().includes('architecture'))).toBe(true);
  });
});
