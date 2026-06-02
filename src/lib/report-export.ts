// 报表导出：按申报表汇总 CSV / 完整 ZIP / 单员工档案 ZIP（仅二审通过数据）
import archiver from 'archiver';
import { PassThrough } from 'stream';
import { prisma } from './prisma';
import { getObjectStream } from './minio';
import { csvField, safeSegment, BOM } from './csv-utils';

const ITEM_STATUS_L2 = 'L2_APPROVED' as const;
const SUB_STATUS_L2 = 'L2_APPROVED' as const;

type SelectedOption = { label?: string; score?: number };

/** 解析 SubmissionItem.selected JSON，返回选项 label 列表 */
function selectedLabels(selected: unknown): string[] {
  if (!Array.isArray(selected)) return [];
  return (selected as SelectedOption[])
    .map((s) => (s && typeof s.label === 'string' ? s.label : ''))
    .filter((s) => s.length > 0);
}

/** 模板列定义：稳定的章节·申报项顺序 */
async function getTemplateColumns(templateId: string) {
  const template = await prisma.formTemplate.findUnique({
    where: { id: templateId },
    select: {
      id: true,
      title: true,
      year: true,
      sections: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          title: true,
          items: {
            orderBy: { sortOrder: 'asc' },
            select: { id: true, title: true },
          },
        },
      },
    },
  });
  if (!template) return null;

  const columns: { itemId: string; sectionTitle: string; itemTitle: string; header: string }[] = [];
  for (const sec of template.sections) {
    for (const it of sec.items) {
      columns.push({
        itemId: it.id,
        sectionTitle: sec.title,
        itemTitle: it.title,
        header: `${sec.title} - ${it.title}`,
      });
    }
  }
  return { template, columns };
}

/** 查询某模板下全部二审通过的 submission（含用户与已通过的申报项） */
async function getApprovedSubmissions(templateId: string) {
  return prisma.submission.findMany({
    where: { templateId, status: SUB_STATUS_L2 },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          employeeNo: true,
          contact: true,
          branch: { select: { name: true } },
          department: { select: { name: true } },
        },
      },
      items: {
        where: { status: ITEM_STATUS_L2 },
        include: { item: { select: { id: true, title: true, sectionId: true } } },
      },
    },
    orderBy: { totalScore: 'desc' },
  });
}

type ApprovedSubmission = Awaited<ReturnType<typeof getApprovedSubmissions>>[number];

/** 构建汇总 CSV 字符串（含 UTF-8 BOM） */
export async function buildTemplateSummaryCsv(templateId: string): Promise<string | null> {
  const meta = await getTemplateColumns(templateId);
  if (!meta) return null;
  const { columns } = meta;
  const subs = await getApprovedSubmissions(templateId);

  const headerCols = ['工号', '姓名', '联系方式', '工区', '部门', '总分', ...columns.map((c) => c.header)];
  const lines: string[] = [headerCols.map(csvField).join(',')];

  for (const sub of subs) {
    const scoreByItem = new Map<string, number>();
    for (const it of sub.items) scoreByItem.set(it.itemId, Number(it.score));

    const row = [
      sub.user.employeeNo ?? '',
      sub.user.fullName,
      sub.user.contact ?? '',
      sub.user.branch?.name ?? '',
      sub.user.department?.name ?? '',
      Number(sub.totalScore).toString(),
      ...columns.map((c) => (scoreByItem.has(c.itemId) ? scoreByItem.get(c.itemId)!.toString() : '')),
    ];
    lines.push(row.map((v) => csvField(String(v))).join(','));
  }

  return BOM + lines.join('\r\n');
}

/** 构建单个 submission 的明细 CSV（章节、申报项、所选项、得分） */
function buildDetailCsv(sub: ApprovedSubmission, sectionTitleById: Map<string, string>): string {
  const header = ['章节', '申报项', '所选项', '得分'];
  const lines: string[] = [header.map(csvField).join(',')];
  // 按 section 再按 item 输出（items 已是 L2_APPROVED）
  const sorted = [...sub.items].sort((a, b) => {
    const sa = sectionTitleById.get(a.item.sectionId) ?? '';
    const sb = sectionTitleById.get(b.item.sectionId) ?? '';
    if (sa !== sb) return sa.localeCompare(sb);
    return a.item.title.localeCompare(b.item.title);
  });
  for (const it of sorted) {
    const row = [
      sectionTitleById.get(it.item.sectionId) ?? '',
      it.item.title,
      selectedLabels(it.selected).join('、'),
      Number(it.score).toString(),
    ];
    lines.push(row.map((v) => csvField(String(v))).join(','));
  }
  return BOM + lines.join('\r\n');
}

/** 把某 submission 的明细 CSV 与附件写入 archive 指定目录 */
async function appendSubmissionToArchive(
  archive: archiver.Archiver,
  sub: ApprovedSubmission,
  folder: string,
  sectionTitleById: Map<string, string>,
) {
  archive.append(buildDetailCsv(sub, sectionTitleById), { name: `${folder}/detail.csv` });

  for (const it of sub.items) {
    const safeTitle = safeSegment(it.item.title);
    const attachments = await prisma.attachment.findMany({ where: { submissionItemId: it.id } });
    for (const att of attachments) {
      try {
        const objStream = await getObjectStream(att.storageKey);
        const safeFilename = safeSegment(att.filename || 'attachment');
        archive.append(objStream, { name: `${folder}/attachments/${safeTitle}-${safeFilename}` });
      } catch (err: any) {
        console.warn(
          `[report-export] Failed to fetch attachment ${att.storageKey} for item "${it.item.title}": ${err?.message}`,
        );
        archive.append(
          JSON.stringify(
            {
              error: 'Attachment unavailable',
              storageKey: att.storageKey,
              filename: att.filename,
              reason: err?.message,
            },
            null,
            2,
          ),
          { name: `${folder}/attachments/_error_${safeTitle}_${att.id}.json` },
        );
      }
    }
  }
}

function newArchiveStream() {
  const stream = new PassThrough();
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => {
    console.error('[report-export] archiver error:', err);
    stream.destroy(err);
  });
  archive.on('warning', (warn) => {
    console.warn('[report-export] archiver warning:', warn);
  });
  archive.pipe(stream);
  return { stream, archive };
}

/** 按申报表导出完整 ZIP：汇总 CSV + 每位员工档案（明细 CSV + 附件） */
export async function buildTemplateZip(templateId: string): Promise<PassThrough | null> {
  const meta = await getTemplateColumns(templateId);
  if (!meta) return null;
  const { template } = meta;

  const { stream, archive } = newArchiveStream();

  (async () => {
    try {
      const subs = await getApprovedSubmissions(templateId);
      const sectionTitleById = new Map<string, string>();
      for (const sec of template.sections) sectionTitleById.set(sec.id, sec.title);

      const summary = await buildTemplateSummaryCsv(templateId);
      if (summary) archive.append(summary, { name: 'summary.csv' });

      archive.append(
        [
          '绩效申报数据导出（二审通过）',
          '================',
          `申报表: ${template.title}`,
          `年度: ${template.year}`,
          `导出时间: ${new Date().toISOString()}`,
          `通过人数: ${subs.length}`,
          '',
          '文件结构:',
          '  summary.csv            — 全员汇总表（含各章节·各申报项得分）',
          '  {工号}-{姓名}/          — 每位员工档案目录',
          '    detail.csv          — 申报明细（章节、申报项、所选项、得分）',
          '    attachments/        — 证书等附件文件',
          '',
          '注意事项:',
          '  - CSV 使用 UTF-8 BOM 编码，Excel 可直接打开中文不乱码',
          '  - 个别附件可能因存储异常无法导出，目录中会有 _error_*.json 占位说明',
        ].join('\n'),
        { name: 'README.txt' },
      );

      const usedFolders = new Map<string, number>();
      for (const sub of subs) {
        const empId = sub.user.employeeNo ?? sub.user.id;
        const empName = safeSegment(sub.user.fullName);
        let folder = `${safeSegment(empId)}-${empName}`;
        // 避免同名目录冲突
        const seen = usedFolders.get(folder) ?? 0;
        usedFolders.set(folder, seen + 1);
        if (seen > 0) folder = `${folder}-${seen + 1}`;
        await appendSubmissionToArchive(archive, sub, folder, sectionTitleById);
      }

      archive.finalize();
    } catch (e: any) {
      console.error('[report-export] buildTemplateZip failed:', e);
      stream.destroy(e instanceof Error ? e : new Error(String(e)));
    }
  })();

  return stream;
}

/** 单员工档案 ZIP：某员工某申报表的明细 CSV + 附件 */
export async function buildEmployeeZip(submissionId: string): Promise<PassThrough | null> {
  const sub = await prisma.submission.findFirst({
    where: { id: submissionId, status: SUB_STATUS_L2 },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          employeeNo: true,
          contact: true,
          branch: { select: { name: true } },
          department: { select: { name: true } },
        },
      },
      template: { select: { id: true, title: true, year: true } },
      items: {
        where: { status: ITEM_STATUS_L2 },
        include: { item: { select: { id: true, title: true, sectionId: true } } },
      },
    },
  });
  if (!sub) return null;

  // 章节标题映射
  const sections = await prisma.formSection.findMany({
    where: { templateId: sub.templateId },
    select: { id: true, title: true },
  });
  const sectionTitleById = new Map<string, string>();
  for (const sec of sections) sectionTitleById.set(sec.id, sec.title);

  const { stream, archive } = newArchiveStream();

  (async () => {
    try {
      archive.append(
        [
          '员工绩效申报档案（二审通过）',
          '================',
          `姓名: ${sub.user.fullName}`,
          `工号: ${sub.user.employeeNo ?? '-'}`,
          `联系方式: ${sub.user.contact ?? '-'}`,
          `工区: ${sub.user.branch?.name ?? '-'}`,
          `部门: ${sub.user.department?.name ?? '-'}`,
          `申报表: ${sub.template.title}（${sub.template.year}）`,
          `总分: ${Number(sub.totalScore)}`,
          `导出时间: ${new Date().toISOString()}`,
        ].join('\n'),
        { name: 'info.txt' },
      );

      await appendSubmissionToArchive(archive, sub as ApprovedSubmission, '.', sectionTitleById);

      archive.finalize();
    } catch (e: any) {
      console.error('[report-export] buildEmployeeZip failed:', e);
      stream.destroy(e instanceof Error ? e : new Error(String(e)));
    }
  })();

  return stream;
}

/** 取申报表标题（用于文件名），不存在返回 null */
export async function getTemplateLabel(templateId: string): Promise<{ title: string; year: number } | null> {
  const t = await prisma.formTemplate.findUnique({
    where: { id: templateId },
    select: { title: true, year: true },
  });
  return t ?? null;
}

/** 取单员工文件名信息 */
export async function getEmployeeLabel(
  submissionId: string,
): Promise<{ fullName: string; employeeNo: string | null; templateTitle: string; year: number } | null> {
  const s = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: {
      user: { select: { fullName: true, employeeNo: true } },
      template: { select: { title: true, year: true } },
    },
  });
  if (!s) return null;
  return {
    fullName: s.user.fullName,
    employeeNo: s.user.employeeNo,
    templateTitle: s.template.title,
    year: s.template.year,
  };
}
