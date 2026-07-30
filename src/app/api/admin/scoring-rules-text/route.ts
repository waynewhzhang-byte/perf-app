// 计分规则「显示文案」覆盖管理（纯展示，不影响分数/算法/事实）
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { SCORING_STANDARDS } from '@/lib/scoring-standards';
import {
  deleteScoringStandardText,
  loadScoringStandardOverrides,
  upsertScoringStandardText,
} from '@/lib/scoring-standard-text';

const MAX_TEXT = 2000;

const UpsertSchema = z.object({
  id: z.string().optional(),
  year: z.number().int().min(2000).max(2100),
  dimensionCode: z.string().min(1),
  title: z.string().trim().max(100).nullable().optional(),
  scoringSummary: z.string().trim().max(MAX_TEXT).nullable().optional(),
  ownerDepartment: z.string().trim().max(100).nullable().optional(),
  referenceFile: z.string().trim().max(200).nullable().optional(),
  notes: z.string().trim().max(MAX_TEXT).nullable().optional(),
});

const DeleteSchema = z.object({ id: z.string() });

/**
 * GET /api/admin/scoring-rules-text?year=2026
 * 返回 11 项的常量默认文案 + 当前已配置的覆盖（按 dimensionCode 索引）。
 * 前端据此显示「默认 vs 当前」。
 */
export async function GET(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const year = Number(new URL(req.url).searchParams.get('year') ?? 2026);
    const overrides = await loadScoringStandardOverrides(prisma, year);

    const defaults = SCORING_STANDARDS.map((s) => ({
      code: s.code,
      title: s.title,
      sectionCode: s.sectionCode,
      sectionTitle: s.sectionTitle,
      maxScore: s.maxScore,
      ownerDepartment: s.ownerDepartment,
      scoringSummary: s.scoringSummary,
      referenceFile: s.referenceFile,
      notes: s.notes,
    }));

    // 覆盖按 dimensionCode → 覆盖对象（含 id，供删除）
    const overrideMap: Record<string, unknown> = {};
    for (const [code, override] of overrides) {
      overrideMap[code] = override;
    }

    return NextResponse.json({ success: true, year, defaults, overrides: overrideMap });
  } catch (e) {
    console.error('GET /api/admin/scoring-rules-text:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

/** PUT：upsert 一条文案覆盖（id 存在则更新，否则按 year+dimensionCode 创建）。 */
export async function PUT(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const parsed = UpsertSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: '参数无效', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    // 仅允许覆盖常量中存在的维度，防止误写未知 code
    const known = SCORING_STANDARDS.some((s) => s.code === parsed.data.dimensionCode);
    if (!known) {
      return NextResponse.json({ error: '未知的计分维度' }, { status: 400 });
    }

    const saved = await upsertScoringStandardText(prisma, parsed.data);
    return NextResponse.json({ success: true, id: saved.id });
  } catch (e) {
    console.error('PUT /api/admin/scoring-rules-text:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

/** DELETE：删除一条覆盖（恢复该维度该年度为常量默认文案）。 */
export async function DELETE(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const parsed = DeleteSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: '参数无效' }, { status: 400 });
    }

    await deleteScoringStandardText(prisma, parsed.data.id);
    return NextResponse.json({ success: true });
  } catch (e) {
    // P2025: 记录不存在（已删除）
    if (e instanceof Error && 'code' in e && (e as { code?: string }).code === 'P2025') {
      return NextResponse.json({ error: '覆盖记录不存在' }, { status: 404 });
    }
    console.error('DELETE /api/admin/scoring-rules-text:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
