export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { importScoreFacts, type FactFieldMapping } from '@/lib/manual-fact-import';

const MappingSchema = z.object({
  employeeNo: z.string(),
  employeeName: z.string().optional().default(''),
  rawScore: z.string().optional().default(''),
  declarationLevel: z.string().optional().default(''),
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
    const result = await importScoreFacts(
      prisma, 'worksite.ticket-execution', '两票执行',
      year, mapping as FactFieldMapping, rows, sourceFile,
    );

    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    console.error('POST /api/admin/import/tickets:', e);
    const message = e instanceof Error ? e.message : '服务器内部错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
