import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = 'aicopilotplatform@gmail.com';
  const rawPassword = 'aicopilotplatform@123';
  const hashedPassword = bcrypt.hashSync(rawPassword, 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash: hashedPassword,
      role: 'ADMIN',
      status: 'ACTIVE',
    },
    create: {
      email,
      passwordHash: hashedPassword,
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

  console.log(`Successfully updated admin user: ${user.email} with role ${user.role} and new password hash.`);
}

main()
  .catch((e) => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
