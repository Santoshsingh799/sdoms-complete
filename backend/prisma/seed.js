import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const hash = (p) => bcrypt.hash(p, 12);

async function main() {
  await prisma.collegeSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, name: 'Amity University Madhya Pradesh' },
  });

  await prisma.user.upsert({
    where: { loginId: 'admin' }, update: { passwordHash: await hash('Admin@123'), isActive: true },
    create: { loginId: 'admin', name: 'College Admin', role: 'ADMIN', passwordHash: await hash('Admin@123') },
  });

  await prisma.user.upsert({
    where: { loginId: 'guard1' }, update: { passwordHash: await hash('Guard@123'), isActive: true },
    create: { loginId: 'guard1', name: 'Gate Guard', role: 'GUARD', passwordHash: await hash('Guard@123') },
  });

  const mentorUser = await prisma.user.upsert({
    where: { loginId: 'mentor1' }, update: { passwordHash: await hash('Mentor@123'), isActive: true },
    create: {
      loginId: 'mentor1', name: 'Dr. Demo Mentor', role: 'MENTOR', mobile: '9000000001',
      passwordHash: await hash('Mentor@123'),
      mentor: { create: { department: 'Information Technology' } },
    },
    include: { mentor: true },
  });

  const studentUser = await prisma.user.upsert({
    where: { loginId: 'A12345' }, update: { passwordHash: await hash('Student@123'), isActive: true },
    create: {
      loginId: 'A12345', name: 'Demo Student', role: 'STUDENT', mobile: '9000000002',
      passwordHash: await hash('Student@123'),
      student: {
        create: {
          enrollmentNo: 'A12345', course: 'B.Tech', branch: 'Information Technology',
          semester: 7, mobile: '9000000002', mentorId: mentorUser.mentor.id,
        },
      },
    },
    include: { student: true },
  });

  const guardian = await prisma.guardian.upsert({
    where: { mobile: '9000000003' }, update: {},
    create: { name: 'Demo Father', mobile: '9000000003' },
  });
  const guardianUser = await prisma.user.upsert({
    where: { loginId: 'guardian1' },
    update: { passwordHash: await hash('Guardian@123'), isActive: true, name: guardian.name, role: 'GUARDIAN' },
    create: { loginId: 'guardian1', name: guardian.name, role: 'GUARDIAN', mobile: guardian.mobile, passwordHash: await hash('Guardian@123') },
  });
  await prisma.guardian.update({ where: { id: guardian.id }, data: { userId: guardianUser.id } });
  await prisma.studentGuardian.upsert({
    where: { studentId_guardianId: { studentId: studentUser.student.id, guardianId: guardian.id } },
    update: {},
    create: { studentId: studentUser.student.id, guardianId: guardian.id, relation: 'Father', isVerified: true, verifiedAt: new Date() },
  });

  console.log('Seed done. Demo logins: admin/Admin@123, mentor1/Mentor@123, guard1/Guard@123, A12345/Student@123');
}

main().finally(() => prisma.$disconnect());
