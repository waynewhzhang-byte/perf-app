/**
 * 绩效事实数据导入 API
 *
 * 上传 Excel → 字段映射 → 评分引擎计算 → 写入 PerformanceFact。
 * 按维度独立上传，管理员在 UI 中手动映射列。
 */
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { computeFactScores, type FactInput, type ScoringRule } from '@/lib/scoring-engine';

const MappingSchema = z.object({
  employeeNo: z.string(),
  employeeName: z.string(),
  role: z.string().optional(),
  eventType: z.string().optional(),
  defectLevel: z.string().optional(),
  defectRef: z.string().optional(),
  eventDate: z.string().optional(),
  score: z.string().optional(),
  faultCount: z.string().optional(),
  rawScore: z.string().optional(),
  incidentId: z.string().optional(),
  declarationLevel: z.string().optional(),
});

const ImportSchema = z.object({
  dimensionCode: z.string().min(1),
  dimensionTitle: z.string().min(1),
  year: z.number().int().min(2000).max(2100),
  sourceFile: z.string().min(1),
  mapping: MappingSchema,
  rows: z.array(z.record(z.string(), z.string())).min(1),
});

// 中文角色名 → FactRole
const ROLE_MAP: Record<string, FactInput['role']> = {
  '第一发现人': 'FIRST_DISCOVERER', 'FIRST_DISCOVERER': 'FIRST_DISCOVERER',
  '共同发现人': 'CO_DISCOVERER', 'CO_DISCOVERER': 'CO_DISCOVERER',
  '第一处理人': 'FIRST_HANDLER', 'FIRST_HANDLER': 'FIRST_HANDLER',
  '共同处理人': 'CO_HANDLER', 'CO_HANDLER': 'CO_HANDLER',
};

const EVENT_TYPE_MAP: Record<string, FactInput['eventType']> = {
  '发现': 'DISCOVERY', 'DISCOVERY': 'DISCOVERY',
  '处理': 'REMEDIATION', 'REMEDIATION': 'REMEDIATION', '消缺': 'REMEDIATION',
};

export async function POST(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const parsed = ImportSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: '参数无效', issues: parsed.error.issues }, { status: 400 });
    }

    const { dimensionCode, dimensionTitle, year, sourceFile, mapping, rows } = parsed.data;

    // 加载评分规则
    const dbRule = await prisma.scoringRule.findUnique({ where: { dimensionCode } });
    if (!dbRule) {
      return NextResponse.json({ error: `未找到维度「${dimensionCode}」的评分规则，请先配置评分规则` }, { status: 400 });
    }
    const rule: ScoringRule = {
      id: dbRule.id,
      dimensionCode: dbRule.dimensionCode,
      ruleType: dbRule.ruleType as ScoringRule['ruleType'],
      cap: Number(dbRule.cap),
      enabled: dbRule.enabled,
      ...(dbRule.config as Record<string, unknown>),
    };

    if (!rule.enabled) {
      return NextResponse.json({ error: '该维度评分规则已禁用' }, { status: 400 });
    }

    // 将 Excel 行转换为 FactInput
    const get = (row: Record<string, string>, field: keyof typeof mapping): string | undefined => {
      const colName = mapping[field];
      if (!colName) return undefined;
      return row[colName]?.trim() || undefined;
    };

    const factInputs: FactInput[] = [];
    for (const row of rows) {
      const employeeNo = get(row, 'employeeNo');
      const employeeName = get(row, 'employeeName');
      if (!employeeNo || !employeeName) continue;

      const roleRaw = get(row, 'role') ?? '';
      const eventTypeRaw = get(row, 'eventType') ?? '';

      factInputs.push({
        employeeNo,
        employeeName,
        dimensionCode,
        role: ROLE_MAP[roleRaw] ?? 'FIRST_DISCOVERER',
        eventType: EVENT_TYPE_MAP[eventTypeRaw] ?? 'DISCOVERY',
        defectLevel: get(row, 'defectLevel') ?? '',
        defectRef: get(row, 'defectRef') ?? employeeNo,
        eventDate: get(row, 'eventDate'),
        sourceFile,
        incidentId: get(row, 'incidentId'),
        faultCount: get(row, 'faultCount') ? parseInt(get(row, 'faultCount')!, 10) || 1 : 1,
        rawScore: get(row, 'rawScore') ? parseFloat(get(row, 'rawScore')!) : undefined,
        declarationLevel: get(row, 'declarationLevel'),
      });
    }

    if (factInputs.length === 0) {
      return NextResponse.json({ error: '没有可导入的有效数据行' }, { status: 400 });
    }

    // 评分引擎计算
    const scored = computeFactScores(factInputs, [rule]);

    // 批量写入（事务内 upsert）
    const result = { total: scored.length, created: 0, updated: 0, skipped: 0 };
    await prisma.$transaction(async (tx) => {
      for (const f of scored) {
        // match user by employeeNo
        const user = await tx.user.findFirst({
          where: { employeeNo: f.employeeNo },
          select: { id: true },
        });

        const existing = await tx.performanceFact.findFirst({
          where: {
            year,
            employeeNo: f.employeeNo,
            dimensionCode,
            defectRef: f.defectRef || f.employeeNo,
            role: f.role as any,
            eventType: f.eventType as any,
          },
        });

        const data = {
          year,
          employeeNo: f.employeeNo,
          employeeName: f.employeeName,
          userId: user?.id ?? null,
          dimensionCode,
          dimensionTitle,
          role: f.role as any,
          eventType: f.eventType as any,
          score: f.score,
          defectRef: f.defectRef || f.employeeNo,
          defectLevel: f.defectLevel ?? '',
          eventDate: f.eventDate ?? null,
          sourceFile,
          metadata: (f.metadata ?? {}) as any,
        };

        if (existing) {
          await tx.performanceFact.update({ where: { id: existing.id }, data });
          result.updated++;
        } else {
          await tx.performanceFact.create({ data });
          result.created++;
        }
      }
    });

    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    console.error('POST /api/admin/import:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
