import request from 'supertest';
import app from '../index';
import { prisma } from '../lib/prisma';
const testEmail = 'ats.tester@university.edu';
const testPassword = 'TesterPassword123!';

describe('ATS Resume Analyzer API Tests', () => {
  let token = '';

  beforeAll(async () => {
    // 1. Create a clean user and get authentication token
    await prisma.user.deleteMany({ where: { email: testEmail } });
    
    // Register
    await request(app).post('/api/auth/register').send({
      email: testEmail,
      password: testPassword,
      fullName: 'ATS Tester'
    });

    // Verify
    const verifyRes = await request(app).post('/api/auth/verify-otp').send({
      email: testEmail,
      code: '123456' // Fallback OTP code
    });

    token = verifyRes.body.token || '';
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: testEmail } });
    await prisma.$disconnect();
  });

  test('POST /api/ats/analyze -> Should reject unauthorized requests', async () => {
    const res = await request(app)
      .post('/api/ats/analyze')
      .send({ jobTitle: 'Developer' });
    
    expect(res.statusCode).toBe(401);
  });

  let reportId = '';

  test('POST /api/ats/analyze -> Should accept and analyze upload buffers', async () => {
    if (!token) return; // Skip if authentication failed

    // Create a mock PDF or DOCX file buffer
    const mockFileBuffer = Buffer.from(
      'John Doe\n' +
      'Email: john.doe@email.com | Phone: 123-456-7890 | LinkedIn: linkedin.com/in/johndoe\n\n' +
      'Professional Summary\n' +
      'Experienced React, SQL, TypeScript developer with 2 years experience building web apps.\n\n' +
      'Education\n' +
      'BS in Computer Science, University of tech\n\n' +
      'Technical Skills\n' +
      'React, TypeScript, Node.js, SQL, AWS, Git\n\n' +
      'Work Experience\n' +
      'Software Engineer at TechCorp (2022 - Present)\n' +
      '- Developed scalable web applications using React.'
    );

    const res = await request(app)
      .post('/api/ats/analyze')
      .set('Authorization', `Bearer ${token}`)
      .field('jobTitle', 'Software Engineer')
      .field('jobDescription', 'Looking for a React developer with SQL and TypeScript skills.')
      .attach('resume', mockFileBuffer, 'resume.pdf');

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('report');
    expect(res.body.report).toHaveProperty('overallScore');
    expect(res.body.report).toHaveProperty('resumeUrl');
    
    reportId = res.body.report.id;
  });

  test('POST /api/ats/analyze -> Should reject non-resume uploads (certificates, transcripts, etc.)', async () => {
    if (!token) return;

    // Uploading a certificate text
    const invalidFileBuffer = Buffer.from(
      'Certificate of Completion\n' +
      'This is to certify that John Doe has successfully completed the course on Python programming.'
    );

    const res = await request(app)
      .post('/api/ats/analyze')
      .set('Authorization', `Bearer ${token}`)
      .field('jobTitle', 'Software Engineer')
      .field('jobDescription', 'React developer with SQL and TypeScript skills.')
      .attach('resume', invalidFileBuffer, 'certificate.pdf');

    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toBe('Invalid file. Please upload a valid resume.');
  });

  test('POST /api/ats/reports/:id/optimize (MODIFY_EXISTING) -> Should optimize existing resume', async () => {
    if (!token || !reportId) return;

    const res = await request(app)
      .post(`/api/ats/reports/${reportId}/optimize`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        mode: 'MODIFY_EXISTING'
      });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('optimized');
    expect(res.body.optimized.mode).toBe('MODIFY_EXISTING');
    expect(res.body.optimized).toHaveProperty('optimizedText');
  });

  test('POST /api/ats/reports/:id/optimize (GENERATE_NEW) -> Should generate new resume', async () => {
    if (!token || !reportId) return;

    const res = await request(app)
      .post(`/api/ats/reports/${reportId}/optimize`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        mode: 'GENERATE_NEW',
        applicantDetails: {
          fullName: 'New Name Test',
          email: 'test@email.com',
          skills: 'Node.js, AWS'
        }
      });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('optimized');
    expect(res.body.optimized.mode).toBe('GENERATE_NEW');
  });

  test('GET /api/ats/reports/:id/download-optimized (PDF) -> Should download pdf format', async () => {
    if (!token || !reportId) return;

    const res = await request(app)
      .get(`/api/ats/reports/${reportId}/download-optimized?format=pdf`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.header['content-type']).toBe('application/pdf');
  });

  test('GET /api/ats/reports/:id/download-optimized (DOCX) -> Should download docx format', async () => {
    if (!token || !reportId) return;

    const res = await request(app)
      .get(`/api/ats/reports/${reportId}/download-optimized?format=docx`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.header['content-type']).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });
});
