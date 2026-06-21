import request from 'supertest';
import app from '../index';
import { prisma } from '../lib/prisma';
const testEmail = 'interview.tester@university.edu';
const testPassword = 'TesterPassword123!';

describe('Mock Interview Engine API Tests', () => {
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
      fullName: 'Interview Tester'
    });

    // Extract OTP from response message e.g. "Local development OTP: 123456"
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

  test('POST /api/interviews/start -> Should initialize session and generate questions', async () => {
    if (!token) return;

    const res = await request(app)
      .post('/api/interviews/start')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'TECHNICAL',
        role: 'Backend Developer',
        company: 'Google',
        difficulty: 'MEDIUM',
        experienceLevel: 'Fresher',
        questionCount: 3
      });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('session');
    expect(res.body.session).toHaveProperty('id');
    expect(res.body.session.questions).toHaveLength(3);
    
    sessionId = res.body.session.id;
    questionId = res.body.session.questions[0].id;
  });

  test('POST /api/interviews/:sessionId/answer -> Should accept typed answer and return score card', async () => {
    if (!token || !sessionId || !questionId) return;

    const res = await request(app)
      .post(`/api/interviews/${sessionId}/answer`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        questionId,
        answerText: 'SQL is a structured table query language for relational databases, NoSQL is for key-value document databases.'
      });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('evaluation');
    expect(res.body.evaluation).toHaveProperty('score');
    expect(res.body.evaluation).toHaveProperty('expectedAnswer');
  });

  test('POST /api/interviews/:sessionId/answer with gibberish -> Should return exactly 0 score', async () => {
    if (!token || !sessionId || !questionId) return;

    const res = await request(app)
      .post(`/api/interviews/${sessionId}/answer`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        questionId,
        answerText: 'asdfghjkl'
      });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('evaluation');
    expect(res.body.evaluation.score).toBe(0);
    expect(res.body.evaluation.correctnessScore).toBe(0);
    expect(res.body.evaluation.communicationScore).toBe(0);
    expect(res.body.evaluation.confidenceScore).toBe(0);
    expect(res.body.evaluation.grammarScore).toBe(0);
    expect(res.body.evaluation.improvementTips).toBe('Answer contains no meaningful technical content.');
  });

  test('POST /api/interviews/:sessionId/answer with "I don\'t know" -> Should return exactly 0 score', async () => {
    if (!token || !sessionId || !questionId) return;

    const res = await request(app)
      .post(`/api/interviews/${sessionId}/answer`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        questionId,
        answerText: "I don't know."
      });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('evaluation');
    expect(res.body.evaluation.score).toBe(0);
    expect(res.body.evaluation.correctnessScore).toBe(0);
    expect(res.body.evaluation.communicationScore).toBe(0);
    expect(res.body.evaluation.confidenceScore).toBe(0);
    expect(res.body.evaluation.grammarScore).toBe(0);
    expect(res.body.evaluation.improvementTips).toBe('No answer was provided.');
  });

  test('POST /api/interviews/:sessionId/answer with wrong answer -> Should return exactly 0 score', async () => {
    if (!token || !sessionId || !questionId) return;

    const res = await request(app)
      .post(`/api/interviews/${sessionId}/answer`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        questionId,
        answerText: 'Gradient descent is a database that stores user profile configurations.'
      });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('evaluation');
    expect(res.body.evaluation.score).toBe(0);
    expect(res.body.evaluation.correctnessScore).toBe(0);
    expect(res.body.evaluation.communicationScore).toBe(0);
    expect(res.body.evaluation.confidenceScore).toBe(0);
    expect(res.body.evaluation.grammarScore).toBe(0);
    expect(res.body.evaluation.improvementTips).toBe('Answer is technically incorrect.');
  });

  test('POST /api/interviews/:sessionId/complete with 0 score -> Should compile 0 score and return tailored feedback', async () => {
    if (!token || !sessionId) return;

    const sessionRes = await prisma.interviewSession.findUnique({
      where: { id: sessionId },
      include: { questions: true }
    });
    
    if (sessionRes && sessionRes.questions) {
      for (const q of sessionRes.questions) {
        await request(app)
          .post(`/api/interviews/${sessionId}/answer`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            questionId: q.id,
            answerText: 'asdfghjkl'
          });
      }
    }

    const res = await request(app)
      .post(`/api/interviews/${sessionId}/complete`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.session.status).toBe('COMPLETED');
    expect(res.body.session.overallScore).toBe(0);
    expect(res.body.session.feedback).toContain('Overall performance was poor (Score: 0%). Weaknesses: Did not answer questions, Missing core concepts, Technical understanding absent.');
  });
});
