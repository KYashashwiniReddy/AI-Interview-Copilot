import request from 'supertest';
import app from '../index';
import { prisma } from '../lib/prisma';

const testEmail = 'optimize.tester@university.edu';
const testPassword = 'TesterPassword123!';

describe('ATS Resume Optimizer API Tests', () => {
  let token = '';
  let reportId = '';

  beforeAll(async () => {
    // Clean up if user already exists
    await prisma.user.deleteMany({ where: { email: testEmail } });

    // Register
    await request(app).post('/api/auth/register').send({
      email: testEmail,
      password: testPassword,
      fullName: 'Optimizer Tester'
    });

    // Verify OTP
    const verifyRes = await request(app).post('/api/auth/verify-otp').send({
      email: testEmail,
      code: '123456'
    });

    token = verifyRes.body.token || '';

    // Create a mock report for our optimize test
    const mockFileBuffer = Buffer.from(
      'Alice Smith\n' +
      'Email: alice.smith@email.com | Phone: 123-456-7890 | LinkedIn: linkedin.com/in/alicesmith\n\n' +
      'Career Objective\n' +
      'Seeking a Python Developer position to utilize experience in cloud deployments.\n\n' +
      'Education\n' +
      'BS in Software Engineering, Science College\n\n' +
      'Technical Skills\n' +
      'Python, AWS, Docker, Git, REST APIs\n\n' +
      'Work Experience\n' +
      'Backend Developer at CloudCo (2021 - Present)\n' +
      '- Developed REST APIs with Python.'
    );
    const res = await request(app)
      .post('/api/ats/analyze')
      .set('Authorization', `Bearer ${token}`)
      .field('jobTitle', 'Python Developer')
      .field('jobDescription', 'Require Python, AWS, Docker and Kubernetes skills.')
      .field('experienceLevel', '1-3 Years')
      .attach('resume', mockFileBuffer, 'resume.pdf');

    if (res.body && res.body.report) {
      reportId = res.body.report.id;
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: testEmail } });
    await prisma.$disconnect();
  });

  test('POST /api/ats/reports/:reportId/optimize -> Should reject unauthorized requests', async () => {
    if (!reportId) return;
    const res = await request(app).post(`/api/ats/reports/${reportId}/optimize`).send();
    expect(res.statusCode).toBe(401);
  });

  test('POST /api/ats/reports/:reportId/optimize -> Should successfully optimize the resume', async () => {
    if (!token || !reportId) return;

    const res = await request(app)
      .post(`/api/ats/reports/${reportId}/optimize`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('optimized');
    expect(res.body.optimized).toHaveProperty('optimizedText');
    expect(res.body.optimized).toHaveProperty('originalScore');
    expect(res.body.optimized).toHaveProperty('optimizedScore');
  });

  test('GET /api/ats/reports/:reportId/download-optimized -> Should stream PDF resume', async () => {
    if (!token || !reportId) return;

    const res = await request(app)
      .get(`/api/ats/reports/${reportId}/download-optimized`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.body).toBeDefined(); // Binary PDF buffer
  });
});
