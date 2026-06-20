export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { runImportPipeline } from '@/lib/import-pipeline';

const BodySchema = z.object({
  year: z.number().int().min(2000).max(2100),
  dryRun: z.boolean().optional(),
  skipBasic: z.boolean().optional(),
  skipTickets: z.boolean().optional(),
  skipDefects: z.boolean().optional(),
  unitFilter: z.string().optional(),
  basicFile: z.string().optional(),
  ticketFile: z.string().optional(),
  defectFile: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: '参数无效', issues: parsed.error.issues }, { status: 400 });
    }

    const result = await runImportPipeline(prisma, {
      ...parsed.data,
      createdBy: session.userId,
    });

    return NextResponse.json({ success: true, result });
  } catch (e) {
    console.error('POST /api/admin/import/pipeline:', e);
    const message = e instanceof Error ? e.message : '服务器内部错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
