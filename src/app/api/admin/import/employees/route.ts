export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { importEmployees, type EmployeeFieldMapping } from '@/lib/employee-import';

const MappingSchema = z.object({
  employeeNo: z.string(),
  fullName: z.string(),
  workArea: z.string(),
  department: z.string().optional().default(''),
  team: z.string().optional().default(''),
  position: z.string().optional().default(''),
  gender: z.string().optional().default(''),
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
    void year; // 员工档案不按年度区分，保留参数供未来扩展

    const result = await importEmployees(prisma, mapping as EmployeeFieldMapping, rows, sourceFile);

    return NextResponse.json({
      success: true,
      total: result.total,
      created: result.usersCreated,
      updated: result.usersUpdated,
      skipped: 0,
    });
  } catch (e) {
    console.error('POST /api/admin/import/employees:', e);
    const message = e instanceof Error ? e.message : '服务器内部错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
