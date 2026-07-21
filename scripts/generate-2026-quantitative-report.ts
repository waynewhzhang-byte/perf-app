#!/usr/bin/env npx tsx
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { prisma } from '../src/lib/prisma';
import {
  buildAnnualQuantitativeReportWorkbook,
  loadAnnualQuantitativeReportRows,
} from '../src/lib/annual-quantitative-report';
import { DECLARATION_LEVELS } from '../src/lib/declaration-level';
import {
  quantitativeReportFilename,
  quantitativeReportUnitLabel,
} from '../src/lib/quantitative-report-contract';

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function main() {
  const year = Number(argValue('--year', '2026'));
  const unit = argValue('--unit', '变电检修中心');
  const outputPath = resolve(argValue('--output', `data/generated/${quantitativeReportFilename(unit)}`));
  const skipped: { employeeNo: string; reason: string }[] = [];
  const rows = await loadAnnualQuantitativeReportRows(prisma, {
    year,
    unit,
    onSkip: (employeeNo, reason) => skipped.push({ employeeNo, reason }),
  });
  if (rows.length === 0) throw new Error(`${year}年度${unit}没有可导出的员工及事实数据`);
  if (skipped.length > 0) {
    console.warn(`⚠️  跳过 ${skipped.length} 个 profile 不全的员工（如 E2E 账号）：`);
    for (const s of skipped.slice(0, 10)) console.warn(`     ${s.employeeNo}: ${s.reason}`);
    if (skipped.length > 10) console.warn(`     ... 共 ${skipped.length} 个`);
  }

  const workbook = buildAnnualQuantitativeReportWorkbook(rows, { year, unit });
  mkdirSync(dirname(outputPath), { recursive: true });
  await workbook.xlsx.writeFile(outputPath);

  const summary = {
    year,
    unit,
    outputPath,
    employeeCount: rows.length,
    tiers: Object.fromEntries(
      DECLARATION_LEVELS.map((tier) => [tier, rows.filter((row) => row.tier === tier).length]),
    ),
    generatedAt: new Date().toISOString(),
  };
  const summaryName = `quantitative-report-summary-${year}-${quantitativeReportUnitLabel(unit)}.json`;
  writeFileSync(resolve(dirname(outputPath), summaryName), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
