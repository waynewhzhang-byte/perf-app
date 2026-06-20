/**
 * 绩效维度注册表 API（模板设计器）
 * GET /api/admin/dimensions
 */
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { buildPerformanceDimensionTree } from '@/lib/performance-dimension-registry';

export async function GET() {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    return NextResponse.json({
      success: true,
      sections: buildPerformanceDimensionTree(),
      note: '一级维度对应表单章节（sectionCode），二级维度对应申报项（dimensionCode），评价标准对应 scoreOptions。',
    });
  } catch (e) {
    console.error('GET /api/admin/dimensions:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
