#!/usr/bin/env npx tsx
/**
 * 2026 数据重导入 CLI（一次性，修 B1/B2/B3 旧 buggy 数据）。
 *
 * 调用 src/lib/*-import.ts 的 batch-replace seam，不直写 DB。
 * 用法：
 *   npx tsx scripts/reimport-2026-data.ts --dimension patent
 *   npx tsx scripts/reimport-2026-data.ts --dimension tech-regulation
 *   npx tsx scripts/reimport-2026-data.ts --dimension tickets
 *   npx tsx scripts/reimport-2026-data.ts --all
 */
import { prisma } from '../src/lib/prisma';
import { loadSheet } from '@/lib/verify/source-loader';
import { importPatentFacts, DEFAULT_PATENT_MAPPING } from '@/lib/patent-import';
import { importTechContribFacts } from '@/lib/tech-contrib-import';

const DATA_DIR = '20260716超高压人员信息表';

function argValue(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function reimportPatents() {
  console.log('--- 重导入发明专利（B3 修复）---');
  const filePath = `${DATA_DIR}/9.发明专利（10条）.xlsx`;
  // 专利列固定：发明人1~4 + 人员编号 4 列（同名「人员编号」被 SheetJS 覆盖，
  // 必须按位置读——loadMatrix 已展开合并单元格并按列序号返回）
  // 这里用 loadSheet 读后，需要手工按列号映射；改用 loadMatrix 按位置读
  const { loadMatrix } = await import('@/lib/verify/source-loader');
  const matrix = loadMatrix(filePath);
  if (matrix.length < 2) throw new Error(`${filePath} 行数不足`);

  // 表头：[0]=序号 [1]=原始申请人 [6]=发明人1 [7]=人员编号 [8]=发明人2 [9]=人员编号 ...
  // 专利名取 col 1（原始申请(专利权)人）
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < matrix.length; i += 1) {
    const r = matrix[i];
    if (!r[0]) continue;
    rows.push({
      patentName: r[1],
      '发明人1': r[6], '工号1': r[7],
      '发明人2': r[8], '工号2': r[9],
      '发明人3': r[10], '工号3': r[11],
      '发明人4': r[12], '工号4': r[13],
    });
  }
  const mapping = {
    patentName: 'patentName',
    inventorCols: ['发明人1', '工号1', '发明人2', '工号2', '发明人3', '工号3', '发明人4', '工号4'],
  };
  const result = await importPatentFacts(prisma, 2026, filePath, rows, mapping, { replaceAcrossSourceFiles: true });
  console.log(JSON.stringify(result));
}

async function reimportTechRegulation() {
  console.log('--- 重导入技术贡献·运规（B1 修复，依赖 parse 合并单元格展开）---');
  const filePath = `${DATA_DIR}/6.《运规》编写 会审人员（135人）.xlsx`;
  // 该文件含合并单元格；loadSheet 已用 expandMergedCells 处理
  const sheet = loadSheet(filePath, 'Sheet1');
  // 真实表头在 row 3（前 2 行是标题/空），loadSheet 默认 row 1 为表头
  // 这里手动按列名读：[姓名=col2, 人员编号=col3, 地域=col4, 运规主要工作=col5, 规程名称=col6]
  // 但 loadSheet 用 row 1 表头会出错，需要直接按位置读
  const { loadMatrix } = await import('@/lib/verify/source-loader');
  const matrix = loadMatrix(filePath, 'Sheet1');
  const rows: Record<string, string>[] = [];
  for (let i = 3; i < matrix.length; i += 1) {
    const r = matrix[i];
    if (!r[0]) continue;
    rows.push({
      employeeNo: r[2],
      employeeName: r[1],
      projectName: r[5],     // 规程名称
      role: r[4],            // 《运规》主要工作
    });
  }
  const result = await importTechContribFacts(
    prisma, 'regulation', 2026, filePath, rows,
    { employeeNo: 'employeeNo', employeeName: 'employeeName', projectName: 'projectName', role: 'role' },
    { replaceAcrossSourceFiles: true },
  );
  console.log(JSON.stringify(result));
}

async function reimportTickets() {
  console.log('--- 重导入两票（B2 修复，操作票按项不按步）---');
  console.log('⚠️  两票重导需要操作票+工作票+工作班成员 4 个文件合并上传；');
  console.log('    建议通过 /admin/import/tickets UI 上传合并后的 10-13.两票数据汇总.xlsx');
  console.log('    （需要先合并 4 个源文件为 2 个 sheet）。');
  console.log('    跳过 CLI 自动重导。');
}

async function main() {
  const dimension = argValue('--dimension');
  const all = process.argv.includes('--all');

  if (all || dimension === 'patent') await reimportPatents();
  if (all || dimension === 'tech-regulation') await reimportTechRegulation();
  if (all || dimension === 'tickets') await reimportTickets();
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
