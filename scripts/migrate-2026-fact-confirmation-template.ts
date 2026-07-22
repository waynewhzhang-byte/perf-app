/**
 * 将已发布的 2026 模板切换为“系统事实自动计分 + 员工确认/申诉”模式。
 * 保留已有申报和原有 11 个评分项 ID，只补入参加工作时间系统确认项。
 */
import { PrismaClient, ScoreMode } from '@prisma/client';

const prisma = new PrismaClient();
const YEAR = 2026;
const HIRE_DATE_CONFIRMATION_CODE = 'profile.hire-date';

async function main() {
  const template = await prisma.formTemplate.findFirst({
    where: { year: YEAR },
    include: {
      sections: {
        include: { items: true },
        orderBy: { sortOrder: 'asc' },
      },
    },
  });
  if (!template) throw new Error('未找到 2026 年申报模板');

  const basicSection = template.sections.find((section) => section.sectionCode === 'basic');
  if (!basicSection) throw new Error('2026 模板缺少“基本素质”一级维度');
  const existing = basicSection.items.find((item) => item.dimensionCode === HIRE_DATE_CONFIRMATION_CODE);

  await prisma.$transaction(async (tx) => {
    await tx.formTemplate.update({
      where: { id: template.id },
      data: {
        description: '本模板严格对应《0.20260716评分标准 对应表.xlsx》。全部绩效维度均由系统带出事实及自动计算分数；员工仅可确认，或提交申诉理由和证明材料。',
        headerFields: [
          { key: 'workArea', enabled: false, required: false },
          { key: 'hireDate', enabled: false, required: false },
          { key: 'declarationLevel', enabled: false, required: false },
          { key: 'declarationSpecialty', enabled: false, required: false },
        ],
      },
    });

    if (existing) {
      await tx.formItem.update({
        where: { id: existing.id },
        data: {
          title: '参加工作时间（系统导入确认）',
          hint: '来源：1.能级评价员工花名册。系统按年度评价截止日自动计算工龄和参评能级；如有异议，请申诉并上传证明材料。',
          maxScore: 0,
          scoreMode: ScoreMode.TIERS,
          scoreOptions: [],
          isRequired: false,
          requireAttachment: false,
          maxSelections: 0,
          sortOrder: -1,
        },
      });
    } else {
      await tx.formItem.create({
        data: {
          sectionId: basicSection.id,
          title: '参加工作时间（系统导入确认）',
          hint: '来源：1.能级评价员工花名册。系统按年度评价截止日自动计算工龄和参评能级；如有异议，请申诉并上传证明材料。',
          dimensionCode: HIRE_DATE_CONFIRMATION_CODE,
          maxScore: 0,
          scoreMode: ScoreMode.TIERS,
          scoreOptions: [],
          isRequired: false,
          requireAttachment: false,
          maxSelections: 0,
          sortOrder: -1,
        },
      });
    }
  });

  console.log(JSON.stringify({
    templateId: template.id,
    existingTemplateItems: template.sections.reduce((count, section) => count + section.items.length, 0),
    hireDateConfirmation: existing ? 'updated' : 'created',
    headerHireDateInput: 'disabled',
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
