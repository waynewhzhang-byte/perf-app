/**
 * 基于《20260716评分标准 对应表.xlsx》生成唯一的 2026 年能级绩效申报模板。
 *
 * 一级维度、二级评分项、满分、事实来源与计分说明均来自
 * scoring-standards.ts；不要在这里另行维护一套维度树。
 */
import { PrismaClient, ScoreMode, TemplateStatus } from '@prisma/client';
import {
  PERFORMANCE_SECTIONS,
  subDimensionsForSection,
} from '../src/lib/scoring-standards';

const prisma = new PrismaClient();

const YEAR = 2026;
const TITLE = '2026年能级评价量化积分申报表';
const DESCRIPTION =
  '国网山西超高压变电公司2026年能级评价量化积分申报表全部维度由外部台账导入并按相关评价标准核算计分，请逐项「确认」或「申诉」（提交申诉理由和证明材料）。';

type ScoreOption = { optionId: string; label: string; score: number; description?: string };

function optionId(code: string, index: number) {
  return `${code}-${index + 1}`;
}

function options(code: string): ScoreOption[] {
  const rows: Array<[string, number, string?]> = (() => {
    switch (code) {
      case 'basic.skill-level':
        return [['高级技师及以上', 4], ['技师', 3], ['高级工', 2], ['其他', 1]];
      case 'basic.title-level':
        return [['高级工程师及以上', 4], ['工程师', 3], ['助理工程师', 2]];
      case 'basic.performance-level':
        return [['近三年 3A', 6], ['近三年 2A1B', 5.5], ['近三年 1A2B', 5], ['近三年 3B', 4.5], ['其他', 4]];
      case 'performance.safety-contribution':
        return [['第一发现人（每次）', 3], ['其他发现人（每次按共同人数分摊）', 3]];
      case 'performance.technical-contribution':
        return [['教材、题库或课件开发（每次）', 3], ['运规编写/会审（每项）', 2], ['两票修订/审查（每项）', 2]];
      case 'performance.competition':
        return [['代表省公司参加国网竞赛（每次）', 10], ['代表公司参加省公司竞赛（每次）', 5]];
      case 'performance.innovation':
        return [['管理/科技创新国网获奖（每项）', 5], ['管理/科技创新省公司获奖（每项）', 3], ['QC/五小国网获奖（每项）', 4], ['QC/五小省公司获奖（每项）', 2], ['发明专利', 4], ['实用新型专利', 3], ['外观设计专利', 2], ['软件著作权', 1]];
      case 'worksite.ticket-execution':
        return [['操作票（每项）', 0.01], ['工作负责人：总工作票（每张）', 5], ['工作负责人：分工作票/单班组一种票（每张）', 3], ['工作负责人：二种票（每张）', 1], ['工作许可人：总工作票（每张）', 1.5], ['工作许可人：单班组一种票（每张）', 1], ['工作许可人：二种票（每张）', 0.3], ['班组成员：单班组一种票（每张）', 1.5], ['班组成员：二种票（每张）', 0.5]];
      case 'worksite.defect-governance':
        return [['危急缺陷第一发现人/处理人（每项）', 3], ['危急缺陷共同发现人/处理人（每项）', 1], ['严重缺陷第一发现人/处理人（每项）', 1], ['严重缺陷共同发现人/处理人（每项）', 0.5], ['一般缺陷第一发现人/处理人（每项）', 0.5]];
      case 'special.violation-severe':
        return [['直接责任人（每次）', -10], ['连带责任人（每次）', -5]];
      case 'special.violation-general':
        return [['直接责任人（每次）', -5], ['连带责任人（每次）', -2.5]];
      default:
        return [];
    }
  })();
  return rows.map(([label, score, description], index) => ({ optionId: optionId(code, index), label, score, description }));
}

function scoreMode(code: string) {
  return code.startsWith('basic.') ? ScoreMode.TIERS : ScoreMode.COUNTED;
}

async function main() {
  const legacyTemplates = await prisma.formTemplate.findMany({
    where: { year: 2025 },
    include: { _count: { select: { submissions: true } } },
  });
  const referencedLegacy = legacyTemplates.filter((template) => template._count.submissions > 0);
  if (referencedLegacy.length > 0) {
    throw new Error(`无法删除仍有申报记录的 2025 模板：${referencedLegacy.map((template) => template.title).join('、')}`);
  }
  await prisma.formTemplate.deleteMany({ where: { year: 2025 } });

  const admin = await prisma.userRole.findFirst({ where: { role: 'ADMIN' } });
  if (!admin) throw new Error('未找到管理员账户，无法创建 2026 年模板');

  const existing = await prisma.formTemplate.findFirst({
    where: { year: YEAR },
    include: { _count: { select: { submissions: true } } },
  });
  if (existing) {
    if (existing._count.submissions > 0) {
      throw new Error('2026 年模板已有申报记录，不能重建；请先迁移已有申报数据');
    }
    await prisma.formTemplate.delete({ where: { id: existing.id } });
  }

  const template = await prisma.formTemplate.create({
    data: {
      year: YEAR,
      title: TITLE,
      description: DESCRIPTION,
      headerFields: [
        { key: 'workArea', enabled: false, required: false },
        { key: 'hireDate', enabled: false, required: false },
        { key: 'declarationLevel', enabled: false, required: false },
        { key: 'declarationSpecialty', enabled: false, required: false },
      ],
      status: TemplateStatus.PUBLISHED,
      publishedAt: new Date(),
      createdBy: admin.userId,
      sections: {
        create: PERFORMANCE_SECTIONS.map((section) => ({
          title: `${['一', '二', '三', '四'][section.excelOrder - 1]}、${section.title}${section.maxScore ? `（满分${section.maxScore}分）` : ''}`,
          description: section.description,
          sectionCode: section.code,
          maxScore: section.maxScore,
          sortOrder: section.excelOrder - 1,
          items: {
            create: [
              ...(section.code === 'basic' ? [{
                title: '参加工作时间（系统导入确认）',
                hint: '来源：1.能级评价员工花名册。系统按年度评价截止日自动计算工龄和参评能级；如有异议，请申诉并上传证明材料。',
                dimensionCode: 'profile.hire-date',
                maxScore: 0,
                scoreMode: ScoreMode.TIERS,
                scoreOptions: [],
                isRequired: false,
                requireAttachment: false,
                maxSelections: 0,
                sortOrder: -1,
              }] : []),
              ...subDimensionsForSection(section.code).map((item, itemIndex) => ({
              title: `${item.title}${item.maxScore ? `（满分${item.maxScore}分）` : ''}`,
              hint: `公示部门：${item.ownerDepartment}。事实来源：${item.referenceFile ?? '评分标准对应表'}。计分说明：${item.scoringSummary}${item.notes ? `。${item.notes}` : ''}`,
              dimensionCode: item.code,
              maxScore: item.maxScore,
              scoreMode: scoreMode(item.code),
              scoreOptions: options(item.code),
              isRequired: false,
              requireAttachment: false,
              maxSelections: item.code.startsWith('basic.') ? 1 : 99,
              sortOrder: itemIndex,
              })),
            ],
          },
        })),
      },
    },
  });

  const itemCount = 1 + PERFORMANCE_SECTIONS.reduce((count, section) => count + subDimensionsForSection(section.code).length, 0);
  console.log(JSON.stringify({ deleted2025Templates: legacyTemplates.length, templateId: template.id, title: template.title, sectionCount: PERFORMANCE_SECTIONS.length, itemCount }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
