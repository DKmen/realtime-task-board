import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database…');

  // Dummy login user – use demo@example.com to sign in immediately
  await prisma.user.upsert({
    where: { email: 'demo@example.com' },
    update: {},
    create: { email: 'demo@example.com', name: 'Demo User' },
  });

  // Additional sample users
  const alice = await prisma.user.upsert({
    where: { email: 'alice@example.com' },
    update: {},
    create: { email: 'alice@example.com', name: 'Alice' },
  });

  const bob = await prisma.user.upsert({
    where: { email: 'bob@example.com' },
    update: {},
    create: { email: 'bob@example.com', name: 'Bob' },
  });

  // create default user
  await prisma.user.upsert({
    where: { email: 'allen.anish@shopup.org' },
    update: {},
    create: { email: 'allen.anish@shopup.org', name: 'Allen Anish' },
  });

  await prisma.user.upsert({
    where: { email: 'shrijeeth.s@silqfi.com' },
    update: {},
    create: { email: 'shrijeeth.s@silqfi.com', name: 'Shrijeeth S' },
  });

  await prisma.user.upsert({
    where: { email: 'soorya@shopup.org' },
    update: {},
    create: { email: 'soorya@shopup.org', name: 'Soorya' },
  });

  await prisma.user.upsert({
    where: { email: 'vishal.ramaprabhu@shopup.org' },
    update: {},
    create: { email: 'vishal.ramaprabhu@shopup.org', name: 'Vishal Ramaprabhu' },
  });

  // Create sample tasks only if none exist (prevents duplicates on restarts)
  const existingCount = await prisma.task.count();
  if (existingCount === 0) {
    const tasks = [
      { title: 'Set up project repository', description: 'Initialize git, add README', status: 'DONE' as const },
      { title: 'Design database schema', description: 'Plan tables and relationships', status: 'DONE' as const },
      { title: 'Build backend API', description: 'Express + Prisma + Socket.io', status: 'PROGRESS' as const },
      { title: 'Build frontend UI', description: 'React + DnD kit', status: 'PROGRESS' as const },
      { title: 'Write unit tests', description: 'Cover core logic', status: 'TODO' as const },
      { title: 'Deploy to production', description: 'Docker + cloud hosting', status: 'TODO' as const },
      { title: 'Write documentation', status: 'TODO' as const },
    ];

    for (const task of tasks) {
      await prisma.task.create({ data: task });
    }

    console.log(`Created ${tasks.length} tasks`);
  } else {
    console.log(`Skipping task seed – ${existingCount} task(s) already exist`);
  }

  console.log(`Seeded users: demo@example.com, ${alice.name}, ${bob.name}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
