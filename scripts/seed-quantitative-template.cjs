/**
 * 根据《量化积分表暂行稿第一稿》创建并发布申报模板
 * 运行：node scripts/seed-quantitative-template.mjs
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const YEAR = 2025;
const TITLE = '国网山西超高压变电公司2025年能级评价量化积分表（暂行稿）';
const DESCRIPTION =
  '依据《量化积分表暂行稿第一稿》：基本素质14分+工作业绩44分+工作现场42分；特殊事项为扣分项。请如实选择档次、填写说明并上传证明材料。';

function item(
  title,
  hint,
  scoreOptions,
  opts = {},
) {
  return {
    title,
    hint,
    isRequired: opts.isRequired ?? false,
    requireAttachment: opts.requireAttachment ?? true,
    maxSelections: opts.maxSelections ?? 1,
    scoreOptions,
    sortOrder: opts.sortOrder ?? 0,
    dimensionCode: opts.dimensionCode ?? null,
  };
}

function section(title, description, items, sortOrder, sectionCode, maxScore) {
  return { title, description, sortOrder, sectionCode, maxScore, items };
}

const templatePayload = {
  year: YEAR,
  title: TITLE,
  description: DESCRIPTION,
  sections: [
    section(
      '一、基本素质（满分14分）',
      '公示部门：组织部。依据：人资2.0系统「我的信息-员工信息」。',
      [
        item(
          '技能等级（满分4分）',
          '按当前最高技能等级选择一项；以人资系统信息为准。',
          [
            { label: '高级技师及以上', score: 4 },
            { label: '技师', score: 3 },
            { label: '高级工', score: 2 },
            { label: '其他', score: 1 },
          ],
          { sortOrder: 0, isRequired: true, dimensionCode: 'basic.skill-level', requireAttachment: false },
        ),
        item(
          '职称等级（满分4分）',
          '按当前最高职称选择一项。',
          [
            { label: '高级工程师及以上', score: 4 },
            { label: '工程师', score: 3 },
            { label: '助理工程师', score: 2 },
          ],
          { sortOrder: 1, isRequired: true, dimensionCode: 'basic.title-level', requireAttachment: false },
        ),
        item(
          '绩效等级（满分6分）',
          '按近三年绩效情况选择一项。',
          [
            { label: '三年绩效 3A', score: 6 },
            { label: '三年绩效 2A1B', score: 5.5 },
            { label: '三年绩效 1A2B', score: 5 },
            { label: '三年绩效 3B', score: 4.5 },
            { label: '满足基本绩效要求（其他情况）', score: 4 },
          ],
          { sortOrder: 2, isRequired: true, dimensionCode: 'basic.performance-level', requireAttachment: false },
        ),
      ],
      0,
      'basic',
      14,
    ),
    section(
      '二、工作业绩（满分44分）',
      '含安全贡献、技术贡献、竞赛比武、发明创新。多项同类事项请在备注中分条列明次数。',
      [
        item(
          '安全贡献（满分12分）',
          '依据：《安全工作奖惩实施细则》、安全突出贡献签字审批单。同一事项仅计一次。可选多项类型，分值按次累计请在备注写明次数。',
          [
            { label: '安全突出贡献-第一发现人（3分/次）', score: 3 },
            { label: '安全突出贡献-其他人员合计（3分/次，请注明人数分摊）', score: 3 },
          ],
          { sortOrder: 0, maxSelections: 2 },
        ),
        item(
          '技术贡献（满分12分）',
          '依据：公司部门及上级单位牵头组织的规范标准修编、资源库建设成果材料（须体现本人）。同一项目仅计一次。',
          [
            { label: '参与制定国标/行标（5分/项）', score: 5 },
            { label: '国网公司级企标（4分/项）', score: 4 },
            { label: '省公司级企标（3分/项）', score: 3 },
            { label: '公司级及以上安规修编/资源库建设（2分/项）', score: 2 },
          ],
          { sortOrder: 1, maxSelections: 4 },
        ),
        item(
          '竞赛比武（满分10分）',
          '依据：获奖证书、通报、公司荣誉册。同一比赛项目仅加分一次；不含上级明确抽调人员名单类调考。',
          [
            { label: '国网公司安全生产类竞赛（10分/次）', score: 10 },
            { label: '省公司竞赛-团体前4或个人前6（5分/次）', score: 5 },
            { label: '国网公司安全生产类调考（5分/次）', score: 5 },
            { label: '省公司调考-团体前4或个人前6（2分/次）', score: 2 },
          ],
          { sortOrder: 2, maxSelections: 4 },
        ),
        item(
          '发明创新（满分10分）',
          '含科技创新、职工技术创新、管理创新、青创、「五小」创新及论文/专利。同一项目多次获奖仅计一次。',
          [
            { label: '国网公司级发明创新奖项（4分/次）', score: 4 },
            { label: '省公司级发明创新奖项（3分/次）', score: 3 },
            { label: '核心期刊及以上论文/发明专利-第1顺位（4分）', score: 4 },
            { label: '核心期刊及以上论文/发明专利-第2顺位（3分）', score: 3 },
            { label: '核心期刊及以上论文/发明专利-第3顺位（2分）', score: 2 },
          ],
          { sortOrder: 3, maxSelections: 5 },
        ),
      ],
      1,
      'performance',
      44,
    ),
    section(
      '三、工作现场（满分42分）',
      '两票执行由安监部按全年执行情况折算；缺陷治理以运检部认定为准。',
      [
        item(
          '两票执行（满分30分）',
          '系统根据安监部导入的全年两票台账自动计分并折算，请核对后确认或申诉。',
          [{ label: '系统导入折算分（无需手工选择）', score: 0 }],
          { sortOrder: 0, requireAttachment: false, dimensionCode: 'worksite.ticket-execution' },
        ),
        item(
          '缺陷治理（满分12分）',
          '系统根据运检部缺陷库导入数据自动计分，请核对后确认或申诉。',
          [{ label: '系统导入累计分（无需手工选择）', score: 0 }],
          { sortOrder: 1, requireAttachment: false, dimensionCode: 'worksite.defect-governance' },
        ),
      ],
      2,
      'worksite',
      42,
    ),
    section(
      '四、特殊事项（扣分项）',
      '依据安监部通报。请选择适用项并在备注写明违章时间、文号；扣分在总分中扣减。',
      [
        item(
          '违章扣分',
          '严重违章：直接责任人10分/次、连带5分/次；一般违章（公司及以上查处）：直接责任人5分/次、连带2.5分/次。',
          [
            { label: '严重违章-直接责任人（-10分/次）', score: -10 },
            { label: '严重违章-连带责任人（-5分/次）', score: -5 },
            { label: '一般违章-直接责任人（-5分/次）', score: -5 },
            { label: '一般违章-连带责任人（-2.5分/次）', score: -2.5 },
          ],
          { sortOrder: 0, maxSelections: 4, requireAttachment: true, isRequired: false },
        ),
      ],
      3,
      'special',
      0,
    ),
  ],
};

async function main() {
  const adminRole = await prisma.userRole.findFirst({
    where: { role: 'ADMIN' },
    include: { user: true },
  });
  if (!adminRole) {
    console.error('未找到管理员，请先创建 ADMIN 账户');
    process.exit(1);
  }

  const existing = await prisma.formTemplate.findFirst({
    where: { year: YEAR, title: TITLE },
    include: { sections: true },
  });

  if (existing) {
    console.log('模板已存在，更新内容并重新发布:', existing.id);
    await prisma.formSection.deleteMany({ where: { templateId: existing.id } });
    await prisma.formTemplate.update({
      where: { id: existing.id },
      data: {
        description: DESCRIPTION,
        status: 'PUBLISHED',
        publishedAt: existing.publishedAt ?? new Date(),
        sections: {
          create: templatePayload.sections.map((s) => ({
            title: s.title,
            description: s.description,
            sortOrder: s.sortOrder,
            sectionCode: s.sectionCode,
            maxScore: s.maxScore,
            items: { create: s.items },
          })),
        },
      },
    });
    console.log(JSON.stringify({ action: 'updated', templateId: existing.id, status: 'PUBLISHED' }, null, 2));
    return;
  }

  const tpl = await prisma.formTemplate.create({
    data: {
      year: YEAR,
      title: TITLE,
      description: DESCRIPTION,
      status: 'PUBLISHED',
      publishedAt: new Date(),
      createdBy: adminRole.userId,
      sections: {
        create: templatePayload.sections.map((s) => ({
          title: s.title,
          description: s.description,
          sortOrder: s.sortOrder,
          sectionCode: s.sectionCode,
          maxScore: s.maxScore,
          items: { create: s.items },
        })),
      },
    },
  });

  const stats = await prisma.formItem.count({ where: { section: { templateId: tpl.id } } });
  console.log(
    JSON.stringify(
      {
        action: 'created',
        templateId: tpl.id,
        status: 'PUBLISHED',
        sections: templatePayload.sections.length,
        items: stats,
        admin: adminRole.user.contact,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
