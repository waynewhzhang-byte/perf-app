// 注册等场景使用的组织架构只读接口（无需登录）
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const [branches, departments, positions, jobTypes, employeeLevels] = await Promise.all([
      prisma.branch.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, name: true, code: true } }),
      prisma.department.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, name: true, branchId: true } }),
      prisma.position.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, name: true } }),
      prisma.jobType.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, name: true } }),
      prisma.employeeLevel.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, name: true } }),
    ]);
    return NextResponse.json({
      success: true,
      branches,
      departments,
      positions,
      jobTypes,
      employeeLevels,
    });
  } catch (e) {
    console.error('GET /api/public/organization:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
