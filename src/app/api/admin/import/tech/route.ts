export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { TECH_CONTRIB_KINDS, importTechContribFacts } from '@/lib/tech-contrib-import';

const MappingSchema = z.object({
  employeeNo: z.string(),
  employeeName: z.string().optional().default(''),
  projectName: z.string().optional().default(''),
  role: z.string().optional().default(''),
});

const BodySchema = z.object({
  year: z.number().int().min(2000).max(2100),
  sourceFile: z.string().min(1),
  mapping: MappingSchema,
  rows: z.array(z.record(z.string(), z.string())).min(1),
});

const VALID_KINDS = new Set(Object.keys(TECH_CONTRIB_KINDS));

export async function POST(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    // kind 通过 query 参数指定：?kind=textbook|regulation|ticket-revision
    const url = new URL(req.url);
    const kind = url.searchParams.get('kind') ?? '';
    if (!VALID_KINDS.has(kind)) {
      return NextResponse.json(
        { error: `无效的 kind 参数: ${kind || '(缺失)'}，应为 ${[...VALID_KINDS].join('/')}` },
        { status: 400 },
      );
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: '参数无效', issues: parsed.error.issues }, { status: 400 });
    }

    const { year, sourceFile, mapping, rows } = parsed.data;
    const result = await importTechContribFacts(prisma, kind, year, sourceFile, rows, mapping);

    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    console.error('POST /api/admin/import/tech:', e);
    const message = e instanceof Error ? e.message : '服务器内部错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
