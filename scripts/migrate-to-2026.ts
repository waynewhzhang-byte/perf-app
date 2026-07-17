#!/usr/bin/env npx tsx
/**
 * 2026年度数据迁移脚本
 *
 * 执行顺序：
 *   1. clean-old-users     — 删除不在2026花名册中的用户
 *   2. import-employees    — 从花名册导入员工+三层组织
 *   3. import-basic-facts  — 基本素质（技能/职称/绩效）
 *   4. import-defects      — 问题清单→缺陷治理
 *   5. import-tickets      — 两票执行（含工作班成员）
 *   6. import-safety       — 安全贡献
 *   7. import-tech-contrib — 技术贡献（教材/运规/两票修订）
 *   8. import-competition  — 竞赛比武
 *   9. import-innovation   — 创新奖项+发明专利
 *   10. compute-scores     — 批量计算导入分
 *
 * 用法: npx tsx scripts/migrate-to-2026.ts [--step <name>] [--dry-run]
 */

const DATA_DIR = '20260716超高压人员信息表';

async function cleanOldUsers(dryRun: boolean) {
  console.log(`[1/10] 清理旧用户数据 ${dryRun ? '(试运行)' : ''}`);
  console.log('  待实现: 调用 scripts/clean-old-users.ts 逻辑');
}

async function importEmployees(dryRun: boolean) {
  console.log(`[2/10] 导入员工档案 ${dryRun ? '(试运行)' : ''}`);
  console.log(`  源文件: ${DATA_DIR}/1.能级评价员工花名册（435人 含职称 技能等级）.xlsx`);
}

async function importBasicFacts(dryRun: boolean) {
  console.log(`[3/10] 导入基本素质事实 ${dryRun ? '(试运行)' : ''}`);
  console.log(`  源文件: ${DATA_DIR}/1.能级评价员工花名册*.xlsx + ${DATA_DIR}/2.人员考核结果*.xlsx`);
}

async function importDefects(dryRun: boolean) {
  console.log(`[4/10] 导入缺陷治理事实 ${dryRun ? '(试运行)' : ''}`);
  console.log(`  源文件: ${DATA_DIR}/14.问题清单数据2025年(277条).xlsx`);
}

async function importTickets(dryRun: boolean) {
  console.log(`[5/10] 导入两票执行事实 ${dryRun ? '(试运行)' : ''}`);
  console.log(`  源文件: ${DATA_DIR}/10.2025操作票*.xlsx + 11.2025工作票*.xlsx`);
  console.log(`  工作班成员: ${DATA_DIR}/12.工作班成员工作票二种表*.xlsx + 13.工作班成员工作票一种表*.xlsx`);
}

async function importSafety(dryRun: boolean) {
  console.log(`[6/10] 导入安全贡献事实 ${dryRun ? '(试运行)' : ''}`);
  console.log(`  源文件: ${DATA_DIR}/3.突出贡献奖人员汇总(43人).xlsx`);
}

async function importTechContrib(dryRun: boolean) {
  console.log(`[7/10] 导入技术贡献事实 ${dryRun ? '(试运行)' : ''}`);
  console.log(`  教材/题库/课件: ${DATA_DIR}/4.参加公司级及以上教材编制*.xlsx`);
  console.log(`  两票修订/审查: ${DATA_DIR}/5.《两票》参与修订人员*.xlsx`);
  console.log(`  运规编写/会审: ${DATA_DIR}/6.《运规》编写 会审人员*.xlsx`);
}

async function importCompetition(dryRun: boolean) {
  console.log(`[8/10] 导入竞赛比武事实 ${dryRun ? '(试运行)' : ''}`);
  console.log(`  源文件: ${DATA_DIR}/7.竞赛比武（4人）.xlsx`);
}

async function importInnovation(dryRun: boolean) {
  console.log(`[9/10] 导入创新奖项事实 ${dryRun ? '(试运行)' : ''}`);
  console.log(`  源文件: ${DATA_DIR}/8.创新奖项人员总汇（34人）.xlsx + ${DATA_DIR}/9.发明专利（10条）.xlsx`);
}

async function computeScores(dryRun: boolean) {
  console.log(`[10/10] 批量计算导入分 ${dryRun ? '(试运行)' : ''}`);
  console.log('  调用: pnpm compute:imported-scores -- --year 2026');
}

const STEPS: { name: string; fn: (dryRun: boolean) => Promise<void> }[] = [
  { name: 'clean-old-users', fn: cleanOldUsers },
  { name: 'import-employees', fn: importEmployees },
  { name: 'import-basic-facts', fn: importBasicFacts },
  { name: 'import-defects', fn: importDefects },
  { name: 'import-tickets', fn: importTickets },
  { name: 'import-safety', fn: importSafety },
  { name: 'import-tech-contrib', fn: importTechContrib },
  { name: 'import-competition', fn: importCompetition },
  { name: 'import-innovation', fn: importInnovation },
  { name: 'compute-scores', fn: computeScores },
];

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const stepIdx = args.indexOf('--step');
  const stepName = stepIdx >= 0 ? args[stepIdx + 1] : null;

  console.log('=== 2026年度数据迁移 ===');
  console.log(`模式: ${dryRun ? '试运行（不写库）' : '正式迁移'}\n`);

  if (stepName) {
    const step = STEPS.find((s) => s.name === stepName);
    if (!step) {
      console.error(`未知步骤: ${stepName}`);
      console.error(`可用步骤: ${STEPS.map((s) => s.name).join(', ')}`);
      process.exit(1);
    }
    await step.fn(dryRun);
  } else {
    for (const step of STEPS) {
      await step.fn(dryRun);
      console.log();
    }
  }

  console.log('\n迁移完成。');
}

main().catch((e) => { console.error(e); process.exit(1); });
