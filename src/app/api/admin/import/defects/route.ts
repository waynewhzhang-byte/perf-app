export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { importScoreFacts, type FactFieldMapping } from '@/lib/manual-fact-import';
import { factImportErrorResponse } from '@/lib/fact-import-http';

const MappingSchema = z.object({
  employeeNo: z.string().min(1),
  employeeName: z.string().optional().default(''),
  role: z.string().optional().default(''),
  eventType: z.string().optional().default(''),
  defectLevel: z.string().optional().default(''),
  /** MATRIX 分组键含 defectRef；缺省会导致同人同等级多缺陷被错误折叠 */
  defectRef: z.string().min(1),
  eventDate: z.string().optional().default(''),
});

const BodySchema = z.object({
  year: z.number().int().min(2000).max(2100),
  sourceFile: z.string().min(1),
  mapping: MappingSchema,
  rows: z.array(z.record(z.string(), z.string())).min(1),
});

export async function POST(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: '参数无效', issues: parsed.error.issues }, { status: 400 });
    }

    const { year, sourceFile, mapping, rows } = parsed.data;

    const emptyRef = rows.filter((r) => !String(r[mapping.defectRef] ?? '').trim()).length;
    if (emptyRef > 0) {
      return NextResponse.json(
        { error: `有 ${emptyRef} 行缺少缺陷编号（defectRef），无法按缺陷计分` },
        { status: 400 },
      );
    }

    const result = await importScoreFacts(
      prisma, 'worksite.defect-governance', '缺陷治理',
      year, mapping as FactFieldMapping, rows, sourceFile,
      { preserveEmployeeScoreTotals: true, createdBy: session.userId },
    );

    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return factImportErrorResponse(e, 'POST /api/admin/import/defects:');
  }
}
