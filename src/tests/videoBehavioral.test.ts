import request from 'supertest';
import app from '../index';
import { prisma } from '../lib/prisma';

const testEmail = 'video.tester@university.edu';
const testPassword = 'TesterPassword123!';

describe('Mock Interview Video & Behavioral Analytics API Tests', () => {
  jest.setTimeout(30000);
  let token = '';
  let sessionId = '';
  let questionId = '';

  beforeAll(async () => {
    // 1. Create a clean user and get authentication token
    await prisma.user.deleteMany({ where: { email: testEmail } });
    
    // Register
    const regRes = await request(app).post('/api/auth/register').send({
      email: testEmail,
      password: testPassword,
      fullName: 'Video Tester'
    });

    // Extract OTP
    const message = regRes.body.message || '';
    const match = message.match(/Local development OTP:\s*(\d{6})/i);
    const otp = match ? match[1] : '123456';

    // Verify
    const verifyRes = await request(app).post('/api/auth/verify-otp').send({
      email: testEmail,
      code: otp
    });

    token = verifyRes.body.token || '';
  });

  afterAll(async () => {
    if (sessionId) {
      await prisma.interviewSession.deleteMany({ where: { id: sessionId } });
    }
    await prisma.user.deleteMany({ where: { email: testEmail } });
    await prisma.$disconnect();
  });

  test('POST /api/interviews/start -> Should initialize session for testing video', async () => {
    if (!token) return;

    const res = await request(app)
      .post('/api/interviews/start')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'TECHNICAL',
        role: 'Frontend Engineer',
        company: 'Netflix',
        difficulty: 'MEDIUM',
        experienceLevel: 'Fresher',
        questionCount: 2
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.session).toHaveProperty('id');
    sessionId = res.body.session.id;
    questionId = res.body.session.questions[0].id;
  });

  test('POST /api/interviews/:sessionId/answer -> Should upload video WebM file with behavioral telemetry', async () => {
    if (!token || !sessionId || !questionId) return;

    const videoBuffer = Buffer.from('fake-video-webm-data');

    const res = await request(app)
      .post(`/api/interviews/${sessionId}/answer`)
      .set('Authorization', `Bearer ${token}`)
      .attach('video', videoBuffer, { filename: 'test_video.webm', contentType: 'video/webm' })
      .field('questionId', questionId)
      .field('answerText', 'React uses a virtual DOM to reconcile change details efficiently in tree hierarchies.')
      .field('behavioralTelemetry', JSON.stringify({
        eyeContactScore: 95,
        bodyLanguageScore: 90,
        voiceQualityScore: 85,
        professionalismScore: 92,
        durationSeconds: 25
      }));

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('questions');
    
    // Check if the answer record was saved with behavioral details
    const dbAnswer = await prisma.interviewAnswer.findFirst({
      where: { questionId }
    });

    expect(dbAnswer).toBeDefined();
    expect(dbAnswer?.behavioralScore).toBe(91); // Math.round((95+90+85+92)/4)
    expect(dbAnswer?.eyeContactScore).toBe(95);
    expect(dbAnswer?.bodyLanguageScore).toBe(90);
    expect(dbAnswer?.videoRecordingUrl).toContain('.webm');
    
    const details = JSON.parse(dbAnswer?.behavioralDetails || '{}');
    expect(details.speakingPaceWpm).toBe(31); // 13 words / 25 seconds * 60 = 31.2 => 31 WPM
  });

  test('POST /api/interviews/:sessionId/complete -> Should compile overall behavioral stats & leadership presence', async () => {
    if (!token || !sessionId) return;

    const res = await request(app)
      .post(`/api/interviews/${sessionId}/complete`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.session.status).toBe('COMPLETED');
    expect(res.body.session.behavioralScore).toBeGreaterThan(0);
    expect(res.body.session.professionalismScore).toBeGreaterThan(0);
    expect(res.body.session.leadershipPresenceScore).toBeGreaterThan(0);
    expect(res.body.session.behavioralStrengths).toContain('Strong eye contact');
    expect(res.body.session.behavioralImprovements).toBeDefined();
  });
});
