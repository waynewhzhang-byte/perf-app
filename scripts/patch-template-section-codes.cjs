/**
 * 为已发布模板补写 sectionCode / maxScore（按章节标题前缀匹配，不重建 sections）
 * 运行：node scripts/patch-template-section-codes.cjs
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const SECTION_MAP = [
  { match: /基本素质/, sectionCode: 'basic', maxScore: 14 },
  { match: /工作业绩/, sectionCode: 'performance', maxScore: 44 },
  { match: /工作现场/, sectionCode: 'worksite', maxScore: 42 },
  { match: /特殊事项/, sectionCode: 'special', maxScore: 0 },
];

async function main() {
  const sections = await prisma.formSection.findMany({
    where: { sectionCode: null },
    select: { id: true, title: true, templateId: true },
  });

  let patched = 0;
  for (const sec of sections) {
    const rule = SECTION_MAP.find((r) => r.match.test(sec.title));
    if (!rule) continue;
    await prisma.formSection.update({
      where: { id: sec.id },
      data: { sectionCode: rule.sectionCode, maxScore: rule.maxScore },
    });
    patched += 1;
    console.log(`patched ${sec.id}: ${sec.title} → ${rule.sectionCode}`);
  }

  console.log(JSON.stringify({ scanned: sections.length, patched }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
