export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { importPatentFacts, DEFAULT_PATENT_MAPPING, type PatentFieldMapping } from '@/lib/patent-import';

/**
 * 发明专利导入：每行 1 个专利，4 位发明人按序展开为 4 条事实。
 *
 * ⚠️ 源数据 9.发明专利.xlsx 表头有 4 列都叫「人员编号」，SheetJS sheet_to_json
 * 会让后列覆盖前列，最终每行只剩 1 个「人员编号」值。解决方案：管理员在 UI
 * 字段映射界面把 4 组发明人列分别映射到不同的逻辑字段名，前端传到后端的 rows
 * 已是按位置区分好的形态。
 *
 * 映射规则（前端 ImportWizard 完成）：
 *   mapping.patentName → 专利名列
 *   mapping.inventorCols → 长度 8 的数组，按 [发明人1姓名, 发明人1工号, 发明人2姓名, ...] 顺序
 */
const MappingSchema = z.object({
  patentName: z.string().min(1),
  inventorCols: z.array(z.string()).length(8),
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

    const { year, sourceFile, rows, mapping } = parsed.data;
    const patentMapping: PatentFieldMapping = {
      patentName: mapping.patentName,
      inventorCols: mapping.inventorCols,
    };
    const result = await importPatentFacts(prisma, year, sourceFile, rows, patentMapping);

    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    console.error('POST /api/admin/import/patent:', e);
    const message = e instanceof Error ? e.message : '服务器内部错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// 保留默认映射供前端参考
export { DEFAULT_PATENT_MAPPING };

