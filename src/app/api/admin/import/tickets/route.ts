export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { aggregateTicketsForImport, TICKET_SHEET_NAMES } from '@/lib/ticket-import-api';
import { persistTicketAggregates, loadUserIdByEmployeeNo } from '@/lib/fact-import-persistence';

const BodySchema = z.object({
  year: z.number().int().min(2000).max(2100),
  sourceFile: z.string().min(1),
  operationRows: z.array(z.record(z.string(), z.string())),
  workRows: z.array(z.record(z.string(), z.string())),
  unitFilter: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: '参数无效', issues: parsed.error.issues }, { status: 400 });
    }

    const { year, sourceFile, operationRows, workRows, unitFilter } = parsed.data;

    if (operationRows.length === 0 && workRows.length === 0) {
      return NextResponse.json(
        { error: `请上传含「${TICKET_SHEET_NAMES.join('」「')}」工作表的 Excel` },
        { status: 400 },
      );
    }

    const ticketResult = await aggregateTicketsForImport(prisma, {
      year,
      sourceFile,
      operationRows,
      workRows,
      unitFilter,
    });

    if (ticketResult.aggregates.length === 0) {
      return NextResponse.json(
        {
          error: '未聚合到任何员工原始分，请检查票状态及姓名是否与员工名册一致',
          unmatched: ticketResult.unmatchedNames.slice(0, 50),
        },
        { status: 400 },
      );
    }

    const userIdByNo = await loadUserIdByEmployeeNo(
      prisma,
      ticketResult.aggregates.map((a) => a.employeeNo),
    );
    const persisted = await persistTicketAggregates(
      prisma,
      year,
      sourceFile,
      ticketResult.aggregates,
      userIdByNo,
    );

    return NextResponse.json({
      success: true,
      total: ticketResult.aggregates.length,
      created: persisted.created,
      updated: 0,
      skipped: 0,
      deleted: persisted.deleted,
      stats: ticketResult.stats,
      unmatched: ticketResult.unmatchedNames,
      unmatchedTotal: ticketResult.unmatchedNames.length,
    });
  } catch (e) {
    console.error('POST /api/admin/import/tickets:', e);
    const message = e instanceof Error ? e.message : '服务器内部错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
