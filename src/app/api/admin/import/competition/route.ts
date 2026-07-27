export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { importCompetitionFacts } from '@/lib/competition-import';
import { factImportErrorResponse } from '@/lib/fact-import-http';

const MappingSchema = z.object({
  employeeNo: z.string(),
  employeeName: z.string().optional().default(''),
  award: z.string().optional().default(''),
  level: z.string().optional().default(''),
  category: z.string().optional().default(''),
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
    const result = await importCompetitionFacts(
      prisma,
      year,
      sourceFile,
      rows,
      mapping,
      { preserveEmployeeScoreTotals: true, createdBy: session.userId },
    );

    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return factImportErrorResponse(e, 'POST /api/admin/import/competition:');
  }
}
