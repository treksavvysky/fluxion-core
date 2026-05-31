import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const identifier = process.argv[2];
const status = process.argv[3] || 'Done';

if (!identifier) {
  console.error("Please specify an issue identifier, e.g., FLX-106");
  process.exit(1);
}

async function main() {
  const issue = await prisma.issue.findUnique({
    where: { identifier }
  });

  if (!issue) {
    console.error(`Issue ${identifier} not found.`);
    process.exit(1);
  }

  const updated = await prisma.issue.update({
    where: { identifier },
    data: { status }
  });

  console.log(`Updated Issue ${updated.identifier}: status set to ${updated.status}`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
