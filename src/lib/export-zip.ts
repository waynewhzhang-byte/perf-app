// 按工区+年度打包 ZIP（流式）
import archiver from 'archiver';
import { PassThrough } from 'stream';
import { prisma } from './prisma';
import { getObjectStream } from './minio';
import { csvField, safeSegment, BOM } from './csv-utils';

export async function buildBranchYearZip(branchId: string, year: number) {
  const stream = new PassThrough();
  const archive = archiver('zip', { zlib: { level: 9 } });

  archive.on('error', (err) => {
    console.error('[export-zip] archiver error:', err);
    stream.destroy(err);
  });

  archive.on('warning', (warn) => {
    console.warn('[export-zip] archiver warning:', warn);
  });

  archive.pipe(stream);

  try {
    // Fetch all PerformanceRecords for the branch + year
    const records = await prisma.performanceRecord.findMany({
      where: {
        year,
        user: { branchId },
      },
      include: { user: true },
    });

    // Build manifest.csv with CSV injection protection and UTF-8 BOM
    const header = 'employee_no,full_name,total_score\n';
    const rows = records
      .map((r) =>
        [
          csvField(r.user.employeeNo ?? ''),
          csvField(r.user.fullName),
          csvField(r.totalScore.toString()),
        ].join(','),
      )
      .join('\n');
    archive.append(BOM + header + rows, { name: 'manifest.csv' });

    // Batch-fetch ALL submission items with attachments in a SINGLE query
    // (fixes N+1 DB query anti-pattern)
    const submissionIds = records.map((r) => r.submissionId);
    const allItems = await prisma.submissionItem.findMany({
      where: { submissionId: { in: submissionIds } },
      include: { attachments: true, item: true },
    });

    // Group by submissionId for O(1) lookup
    const itemsBySubmission = new Map<string, typeof allItems>();
    for (const item of allItems) {
      const list = itemsBySubmission.get(item.submissionId);
      if (list) {
        list.push(item);
      } else {
        itemsBySubmission.set(item.submissionId, [item]);
      }
    }

    // Root-level README explaining the ZIP structure
    archive.append(
      [
        '绩效申报数据导出',
        '================',
        `工区: ${branchId}`,
        `年度: ${year}`,
        `导出时间: ${new Date().toISOString()}`,
        '',
        '文件结构:',
        '  manifest.csv          — 员工申报汇总表（员工编号、姓名、总分）',
        '  {工号}-{姓名}/         — 每位员工的申报目录',
        '    archive.json        — 申报详情快照（申报项、分值、附件元数据）',
        '    attachments/        — 申报附件文件',
        '',
        '注意事项:',
        '  - manifest.csv 使用 UTF-8 编码，如 Excel 打开后中文乱码请用 UTF-8 方式导入',
        '  - 部分附件可能因存储异常而无法导出，导出目录中会包含 _error_*.json 占位说明',
      ].join('\n'),
      { name: 'README.txt' },
    );

    for (const rec of records) {
      const empId = rec.user.employeeNo ?? rec.user.id;
      const empName = safeSegment(rec.user.fullName);
      const folder = `${empId}-${empName}`;
      archive.append(JSON.stringify(rec.archivedData, null, 2), {
        name: `${folder}/archive.json`,
      });

      const items = itemsBySubmission.get(rec.submissionId) ?? [];
      for (const it of items) {
        const safeTitle = safeSegment(it.item.title);
        for (const att of it.attachments) {
          try {
            const objStream = await getObjectStream(att.storageKey);
            const safeFilename = safeSegment(att.filename || 'attachment');
            archive.append(objStream, {
              name: `${folder}/attachments/${safeTitle}-${safeFilename}`,
            });
          } catch (err: any) {
            // Gracefully handle missing/deleted MinIO objects:
            // append an error placeholder instead of corrupting the ZIP stream.
            console.warn(
              `[export-zip] Failed to fetch attachment ${att.storageKey} ` +
                `for item "${it.item.title}": ${err.message}`,
            );
            archive.append(
              JSON.stringify(
                {
                  error: 'Attachment unavailable',
                  storageKey: att.storageKey,
                  filename: att.filename,
                  reason: err.message,
                },
                null,
                2,
              ),
              {
                name: `${folder}/attachments/_error_${safeTitle}_${att.id}.json`,
              },
            );
          }
        }
      }
    }

    archive.finalize();
  } catch (e: any) {
    // Catch synchronous failures during setup / append (DB errors, etc.)
    // before finalize(). Streaming errors during finalize() are handled by
    // the 'error' event handler above.
    console.error('[export-zip] buildBranchYearZip failed:', e);
    stream.destroy(e instanceof Error ? e : new Error(String(e)));
  }

  return stream;
}
