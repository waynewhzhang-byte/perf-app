// 公开接口：获取单个已发布模板（员工填报时调用，无需 admin 权限）
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const template = await prisma.formTemplate.findUnique({
      where: { id: params.id },
      include: {
        sections: {
          include: { items: { orderBy: { sortOrder: 'asc' } } },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!template) {
      return NextResponse.json({ error: '模板不存在' }, { status: 404 });
    }

    if (template.status !== 'PUBLISHED') {
      return NextResponse.json({ error: '该表单未发布' }, { status: 404 });
    }

    return NextResponse.json({ success: true, template });
  } catch (e) {
    console.error('GET /api/templates/[id]:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
