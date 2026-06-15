/**
 * 获取当前用户在指定模板下的系统填充事实数据。
 *
 * GET /api/facts?templateId=xxx
 * → 返回模板中 dimensionCode 对应的 PerformanceFact 列表，用于前端渲染系统填充项。
 */
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

export async function GET(req: Request) {
  const s = await getSession(false);
  if (!s) return NextResponse.json({ error: '未授权' }, { status: 401 });

  const templateId = new URL(req.url).searchParams.get('templateId');
  if (!templateId) return NextResponse.json({ error: '缺少 templateId' }, { status: 400 });

  // 获取模板的基础信息
  const template = await prisma.formTemplate.findUnique({
    where: { id: templateId },
    select: { year: true },
  });
  if (!template) return NextResponse.json({ error: '模板不存在' }, { status: 404 });

  // 获取模板中所有绑定了 dimensionCode 的申报项
  const sections = await prisma.formSection.findMany({
    where: { templateId },
    include: {
      items: {
        where: { dimensionCode: { not: null } },
      },
    },
  });

  const dimensionItems = sections.flatMap((sec) => sec.items);
  const dimensionCodes = dimensionItems.map((it) => it.dimensionCode!).filter(Boolean);
  if (dimensionCodes.length === 0) {
    return NextResponse.json({ success: true, facts: [], items: [] });
  }

  // 查找员工工号
  const user = await prisma.user.findUnique({
    where: { id: s.userId },
    select: { employeeNo: true },
  });
  if (!user?.employeeNo) {
    return NextResponse.json({ success: true, facts: [], items: [] });
  }

  // 查询该员工在该年度的所有 PerformanceFact
  const facts = await prisma.performanceFact.findMany({
    where: {
      year: template.year,
      employeeNo: user.employeeNo,
      dimensionCode: { in: dimensionCodes },
    },
  });

  // 按 itemId 组织返回
  const items = dimensionItems.map((it) => ({
    itemId: it.id,
    itemTitle: it.title,
    dimensionCode: it.dimensionCode,
    scoreMode: it.scoreMode,
    maxScore: it.maxScore,
    facts: facts
      .filter((f) => f.dimensionCode === it.dimensionCode)
      .map((f) => ({
        id: f.id,
        role: f.role,
        eventType: f.eventType,
        score: Number(f.score),
        defectRef: f.defectRef,
        defectLevel: f.defectLevel,
        eventDate: f.eventDate,
      })),
    totalScore: facts
      .filter((f) => f.dimensionCode === it.dimensionCode)
      .reduce((sum, f) => sum + Number(f.score), 0),
  }));

  return NextResponse.json({ success: true, items });
}
