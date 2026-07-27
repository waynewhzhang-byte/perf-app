/**
 * 同步能级评价申报专业字典，并启用 2026 模板表头「申报专业」必填。
 *
 * - 确保 7 个标准专业存在且 sortOrder 正确
 * - 删除未被任何申报引用的旧专业名
 * - 更新 2026 年模板 headerFields：declarationSpecialty enabled+required
 *
 * 用法：npx tsx scripts/sync-declaration-specialties.ts
 */
import { PrismaClient } from '@prisma/client';
import { DECLARATION_SPECIALTY_NAMES } from '../src/lib/declaration-specialties';

const prisma = new PrismaClient();
const YEAR = 2026;

async function main() {
  const ensured: string[] = [];
  for (const [idx, name] of DECLARATION_SPECIALTY_NAMES.entries()) {
    const existing = await prisma.declarationSpecialty.findUnique({ where: { name } });
    if (existing) {
      await prisma.declarationSpecialty.update({
        where: { id: existing.id },
        data: { sortOrder: idx },
      });
      ensured.push(`${name} (updated sortOrder=${idx})`);
    } else {
      await prisma.declarationSpecialty.create({ data: { name, sortOrder: idx } });
      ensured.push(`${name} (created sortOrder=${idx})`);
    }
  }

  const all = await prisma.declarationSpecialty.findMany({
    include: { _count: { select: { submissions: true } } },
  });
  const allowed = new Set<string>(DECLARATION_SPECIALTY_NAMES);
  const removed: string[] = [];
  const clearedRefs: string[] = [];
  for (const row of all) {
    if (allowed.has(row.name)) continue;
    if (row._count.submissions > 0) {
      // 清空旧专业引用，强制员工按新字典重新选择
      const cleared = await prisma.submission.updateMany({
        where: { declarationSpecialtyId: row.id },
        data: { declarationSpecialtyId: null, declarationSpecialtyName: null },
      });
      clearedRefs.push(`${row.name} → cleared ${cleared.count} submissions`);
    }
    await prisma.declarationSpecialty.delete({ where: { id: row.id } });
    removed.push(row.name);
  }

  const templates = await prisma.formTemplate.findMany({ where: { year: YEAR } });
  const headerFields = [
    { key: 'workArea', enabled: false, required: false },
    { key: 'hireDate', enabled: false, required: false },
    { key: 'declarationLevel', enabled: false, required: false },
    { key: 'declarationSpecialty', enabled: true, required: true },
  ];
  for (const template of templates) {
    await prisma.formTemplate.update({
      where: { id: template.id },
      data: { headerFields },
    });
  }

  console.log(JSON.stringify({
    ensured,
    removed,
    clearedRefs,
    templatesUpdated: templates.map((t) => t.id),
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
