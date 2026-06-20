/**
 * 将评分标准表中的默认规则写入 ScoringRule 表
 * 运行：pnpm seed:scoring-rules
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { defaultScoringRuleConfigs } from '../src/lib/scoring-standards';

async function main() {
  console.log('写入默认评分规则…');
  for (const rule of defaultScoringRuleConfigs()) {
    await prisma.scoringRule.upsert({
      where: { dimensionCode: rule.dimensionCode },
      create: {
        dimensionCode: rule.dimensionCode,
        dimensionName: rule.dimensionName,
        ruleType: rule.ruleType,
        cap: new Prisma.Decimal(rule.cap),
        enabled: true,
        config: rule.config as Prisma.InputJsonValue,
      },
      update: {
        dimensionName: rule.dimensionName,
        ruleType: rule.ruleType,
        cap: new Prisma.Decimal(rule.cap),
        config: rule.config as Prisma.InputJsonValue,
      },
    });
    console.log(`  ✓ ${rule.dimensionName} (${rule.ruleType})`);
  }
  console.log('完成');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
