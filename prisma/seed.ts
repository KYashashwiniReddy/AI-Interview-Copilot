import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load env variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const prisma = new PrismaClient();

async function main() {
  console.log('Starting seeding database...');

  const adminEmail = 'aicopilotplatform@gmail.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'aicopilotplatform@123';

  // 1. Create Default Admin User in Supabase Auth if possible
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && serviceRoleKey) {
    try {
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      });
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email: adminEmail,
        password: adminPassword,
        email_confirm: true,
        user_metadata: { full_name: 'NovaHire AI Admin' }
      });
      if (error) {
        console.log(`Supabase Admin user create response/error: ${error.message}`);
      } else {
        console.log(`Admin user ${adminEmail} created/verified in Supabase Auth via Admin client.`);
      }
    } catch (err: any) {
      console.error('Failed to create admin user via Supabase admin client:', err);
    }
  } else if (supabaseUrl && supabaseKey) {
    try {
      const supabase = createClient(supabaseUrl, supabaseKey);
      const { data, error } = await supabase.auth.signUp({
        email: adminEmail,
        password: adminPassword,
        options: {
          data: {
            full_name: 'NovaHire AI Admin'
          }
        }
      });
      if (error) {
        if (error.message.includes('already registered') || error.message.includes('already exists')) {
          console.log(`Admin user ${adminEmail} is already registered in Supabase.`);
        } else {
          console.error(`Failed to register admin in Supabase:`, error.message);
        }
      } else {
        console.log(`Admin user ${adminEmail} registered in Supabase successfully.`);
      }
    } catch (err: any) {
      console.error('Error during Supabase sign-up:', err);
    }
  }

  // 2. Create/Upsert Admin Users in local DB
  const adminPasswordHash = bcrypt.hashSync(adminPassword, 10);
  const platformAdmin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      role: 'ADMIN',
      status: 'ACTIVE'
    },
    create: {
      email: adminEmail,
      passwordHash: adminPasswordHash,
      role: 'ADMIN',
      status: 'ACTIVE',
      profile: {
        create: {
          fullName: 'NovaHire AI Admin',
          currentRole: 'Admin',
          experienceLevel: '5+ Years',
          skills: JSON.stringify(['Management', 'Security', 'Database']),
        },
      },
    },
  });
  console.log(`Admin user seeded in local DB: ${platformAdmin.email}`);

  // Create legacy admin for backward compatibility / tests
  const legacyAdminPasswordHash = bcrypt.hashSync('admin123', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@novahire.com' },
    update: {},
    create: {
      email: 'admin@novahire.com',
      passwordHash: legacyAdminPasswordHash,
      role: 'ADMIN',
      status: 'ACTIVE',
      profile: {
        create: {
          fullName: 'System Administrator',
          currentRole: 'Admin',
          experienceLevel: '5+ Years',
          skills: JSON.stringify(['Management', 'Security', 'Database']),
        },
      },
    },
  });
  console.log(`Legacy Admin user created: ${admin.email}`);

  // 2. Create Default Student User
  const studentPasswordHash = bcrypt.hashSync('student123', 10);
  const student = await prisma.user.upsert({
    where: { email: 'student@novahire.com' },
    update: {},
    create: {
      email: 'student@novahire.com',
      passwordHash: studentPasswordHash,
      role: 'STUDENT',
      status: 'ACTIVE',
      profile: {
        create: {
          fullName: 'John Doe',
          currentRole: 'Software Engineer Intern',
          experienceLevel: 'Fresher',
          skills: JSON.stringify(['JavaScript', 'React', 'Node.js', 'SQL']),
        },
      },
    },
  });
  console.log(`Student user created: ${student.email}`);

  // 3. Populate Question Bank
  const questions = [
    // TECHNICAL - Software Engineer / Backend Developer
    {
      questionText: 'Explain the difference between SQL and NoSQL databases, and when you would choose one over the other.',
      category: 'TECHNICAL',
      role: 'Backend Developer',
      difficulty: 'MEDIUM',
      expectedAnswer: 'SQL databases are relational, table-based, have a predefined schema, and scale vertically. They are best for complex queries and transactional consistency (ACID). NoSQL databases are non-relational, document or key-value based, have dynamic schemas, and scale horizontally. They are ideal for unstructured data and massive read/write volumes.',
    },
    {
      questionText: 'What is a deadlock in concurrent programming? How can deadlocks be prevented?',
      category: 'TECHNICAL',
      role: 'Software Engineer',
      difficulty: 'HARD',
      expectedAnswer: 'A deadlock occurs when two or more threads are blocked forever, each waiting for a resource held by the other. Deadlocks can be prevented by avoiding circular wait conditions, enforcing a strict resource locking order, using lock timeouts, or using deadlock detection algorithms.',
    },
    {
      questionText: 'What is the purpose of indexes in database management systems, and what is the trade-off of using them?',
      category: 'TECHNICAL',
      role: 'Software Engineer',
      difficulty: 'EASY',
      expectedAnswer: 'Database indexes speed up data retrieval operations (SELECT queries) by creating a lookup structure (usually B-Trees). The trade-off is that they consume extra storage space and slow down write operations (INSERT, UPDATE, DELETE) because the index structure must be updated.',
    },
    // TECHNICAL - Frontend Developer
    {
      questionText: 'What is the Virtual DOM in React, and how does the reconciliation process work?',
      category: 'TECHNICAL',
      role: 'Frontend Developer',
      difficulty: 'MEDIUM',
      expectedAnswer: 'The Virtual DOM is a lightweight JavaScript representation of the real DOM. When components state changes, React updates the Virtual DOM, compares it with a previous snapshot (diffing), and then batch-applies the minimum changes to the real DOM (reconciliation) for optimal rendering performance.',
    },
    {
      questionText: 'Explain the concept of closures in JavaScript and provide a common use case.',
      category: 'TECHNICAL',
      role: 'Frontend Developer',
      difficulty: 'MEDIUM',
      expectedAnswer: 'A closure is a function that retains access to its lexical scope even when executed outside that scope. A common usecase is data encapsulation (creating private variables) or creating factory functions.',
    },
    // SYSTEM DESIGN
    {
      questionText: 'How would you design a URL shortening service like Bitly? What are the key bottlenecks?',
      category: 'SYSTEM_DESIGN',
      role: 'Software Engineer',
      difficulty: 'HARD',
      expectedAnswer: 'Key considerations include generating unique short aliases (using Base62 encoding on an auto-incrementing ID), redirecting efficiently using HTTP 301/302 statuses, and caching hot URLs using Redis to handle high read volumes. Bottlenecks are mainly read throughput and storage scaling.',
    },
    {
      questionText: 'Design a real-time notification service that can scale to millions of active users per minute.',
      category: 'SYSTEM_DESIGN',
      role: 'Cloud Engineer',
      difficulty: 'HARD',
      expectedAnswer: 'We would use WebSockets or Server-Sent Events (SSE) for push connections, backed by a Pub/Sub message broker like Redis or RabbitMQ to route messages. Cache user connection states, rate limit senders, and execute message templates asynchronously using worker queues.',
    },
    // BEHAVIORAL
    {
      questionText: 'Describe a situation where you had a significant disagreement with a colleague or manager. How did you resolve it?',
      category: 'BEHAVIORAL',
      role: 'Software Engineer',
      difficulty: 'MEDIUM',
      expectedAnswer: 'Focus on communication, active listening, objective data comparison (e.g., comparing design doc trade-offs rather than opinions), compromise, and final alignment under the goal of project success.',
    },
    {
      questionText: 'Tell me about a time you made a major mistake or failed at a task. What did you do, and what did you learn?',
      category: 'BEHAVIORAL',
      role: 'Software Engineer',
      difficulty: 'EASY',
      expectedAnswer: 'Acknowledge the mistake honestly, explain the immediate remediation steps taken to minimize damage, analyze the root cause, and describe the preventative safeguards or processes implemented since.',
    },
    // HR
    {
      questionText: 'Why do you want to work for our company and what makes you a good fit for this role?',
      category: 'HR',
      role: 'Software Engineer',
      difficulty: 'EASY',
      expectedAnswer: 'Demonstrate research of the company values, culture, and products. Link your technical background (e.g. React/Node) and soft skills (collaboration, eagerness to learn) to the problems the company is solving.',
    },
    {
      questionText: 'Where do you see yourself in five years? What are your career aspirations?',
      category: 'HR',
      role: 'Software Engineer',
      difficulty: 'EASY',
      expectedAnswer: 'Express interest in growing technically (becoming a Senior/Staff Engineer or Technical Architect) or leadership-wise, taking on more architecture design, mentoring junior developers, and contributing to core business goals.',
    }
  ];

  for (const q of questions) {
    await prisma.questionBank.create({
      data: q,
    });
  }

  console.log(`Seeded ${questions.length} interview questions into the QuestionBank.`);
  console.log('Seeding database completed successfully!');
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
