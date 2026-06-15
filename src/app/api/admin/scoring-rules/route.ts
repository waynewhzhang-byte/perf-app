// 评分规则 CRUD（管理员维护 ScoringRule）
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { DIMENSION_DEFS } from '@/lib/dimension-codes';

const RULE_TYPES = ['MATRIX', 'SHARE', 'NORMALIZE'] as const;

// ── Config sub-schemas per rule type ────────────────────────────────

const MatrixConfigSchema = z.object({
  matrix: z.record(z.string(), z.record(z.string(), z.number())),
});

const ShareRoleConfigSchema = z.object({
  perIncident: z.number().optional(),
  totalShare: z.number().optional(),
  multiplyByFaultCount: z.boolean().optional(),
});

const ShareConfigSchema = z.object({
  roles: z.record(z.string(), ShareRoleConfigSchema),
  groupBy: z.string().optional(),
});

const NormalizeConfigSchema = z.object({
  targetMaxScore: z.number().min(1),
  sourceKey: z.string().optional(),
  normalizeWithin: z.string().optional(),
});

const ConfigByType: Record<string, z.ZodTypeAny> = {
  MATRIX: MatrixConfigSchema,
  SHARE: ShareConfigSchema,
  NORMALIZE: NormalizeConfigSchema,
};

// ── Full schemas ────────────────────────────────────────────────────

const CreateSchema = z.object({
  dimensionCode: z.string().min(1),
  ruleType: z.enum(RULE_TYPES),
  cap: z.number().min(0),
  enabled: z.boolean().default(true),
  config: z.record(z.string(), z.unknown()),
});

const UpdateSchema = CreateSchema.extend({ id: z.string() });

const DeleteSchema = z.object({ id: z.string() });

// ── Handlers ────────────────────────────────────────────────────────

export async function GET() {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const rules = await prisma.scoringRule.findMany({
      orderBy: { createdAt: 'asc' },
    });

    const safe = rules.map((r) => ({
      id: r.id,
      dimensionCode: r.dimensionCode,
      dimensionName: r.dimensionName,
      ruleType: r.ruleType,
      cap: Number(r.cap),
      enabled: r.enabled,
      config: r.config as Record<string, unknown>,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));

    return NextResponse.json({ success: true, rules: safe, dimensions: DIMENSION_DEFS });
  } catch (e) {
    console.error('GET /api/admin/scoring-rules:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const parsed = CreateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: '参数无效', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const { dimensionCode, ruleType, cap, enabled, config } = parsed.data;

    // Validate config against ruleType schema
    const configSchema = ConfigByType[ruleType];
    if (configSchema) {
      const configResult = configSchema.safeParse(config);
      if (!configResult.success) {
        return NextResponse.json(
          { error: '规则配置无效', issues: configResult.error.issues },
          { status: 400 },
        );
      }
    }

    // Derive dimension name from DIMENSION_DEFS
    const def = DIMENSION_DEFS.find((d) => d.code === dimensionCode);
    const dimensionName = def?.name ?? dimensionCode;

    // Check uniqueness
    const existing = await prisma.scoringRule.findUnique({
      where: { dimensionCode },
    });
    if (existing) {
      return NextResponse.json(
        { error: `维度「${dimensionName}」已配置评分规则，请编辑已有规则` },
        { status: 409 },
      );
    }

    const created = await prisma.scoringRule.create({
      data: {
        dimensionCode,
        dimensionName,
        ruleType,
        cap,
        enabled,
        config: config as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json({ success: true, id: created.id });
  } catch (e) {
    console.error('POST /api/admin/scoring-rules:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const parsed = UpdateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: '参数无效', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const { id, dimensionCode, ruleType, cap, enabled, config } = parsed.data;

    // Validate config against ruleType schema
    const configSchema = ConfigByType[ruleType];
    if (configSchema) {
      const configResult = configSchema.safeParse(config);
      if (!configResult.success) {
        return NextResponse.json(
          { error: '规则配置无效', issues: configResult.error.issues },
          { status: 400 },
        );
      }
    }

    const def = DIMENSION_DEFS.find((d) => d.code === dimensionCode);
    const dimensionName = def?.name ?? dimensionCode;

    await prisma.scoringRule.update({
      where: { id },
      data: {
        dimensionCode,
        dimensionName,
        ruleType,
        cap,
        enabled,
        config: config as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: '规则不存在' }, { status: 404 });
    }
    console.error('PUT /api/admin/scoring-rules:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const parsed = DeleteSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: '参数无效' }, { status: 400 });
    }

    await prisma.scoringRule.delete({ where: { id: parsed.data.id } });
    return NextResponse.json({ success: true });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: '规则不存在' }, { status: 404 });
    }
    console.error('DELETE /api/admin/scoring-rules:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
