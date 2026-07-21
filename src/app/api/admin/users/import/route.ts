/**
 * 员工批量导入 API
 *
 * 上传 Excel (.xlsx) → 解析员工行 → 计算能级等级 → 批量 upsert User 记录。
 * Excel 列支持手动映射：工号、姓名、性别、组织单位、能级专业、工种、入职时间。
 */
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { levelFromHireDate } from '@/lib/declaration-level';
import { hashPassword } from '@/lib/password';

const RowSchema = z.object({
  employeeNo: z.string().min(1, '工号不能为空'),
  name: z.string().min(1, '姓名不能为空'),
  gender: z.string().optional(),
  branchName: z.string().optional(),
  specialty: z.string().optional(),
  jobType: z.string().optional(),
  hireDate: z.string().optional(),
});

const ImportSchema = z.object({
  rows: z.array(RowSchema).min(1, '至少需要一条员工记录'),
});

export async function POST(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const parsed = ImportSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: '参数无效', issues: parsed.error.issues }, { status: 400 });
    }

    const results: { employeeNo: string; name: string; level: string; created: boolean }[] = [];

    // 预计算能级等级
    const levelByNo = new Map<string, string>();
    for (const row of parsed.data.rows) {
      if (row.hireDate) {
        const d = new Date(row.hireDate);
        if (!Number.isNaN(d.getTime())) {
          const level = levelFromHireDate(d);
          if (level) levelByNo.set(row.employeeNo, level);
        }
      }
    }

    // 批量查询已有用户（1 次查询替代 N 次 findFirst）
    const employeeNos = parsed.data.rows.map((r) => r.employeeNo);
    const existingUsers = await prisma.user.findMany({
      where: { employeeNo: { in: employeeNos } },
      select: { id: true, employeeNo: true },
    });
    const existingByNo = new Map(existingUsers.map((u) => [u.employeeNo!, u]));

    // 预计算密码哈希（bcrypt 是 CPU 密集型操作，不应在事务内执行）
    const passwordHashes = new Map<string, string>();
    for (const row of parsed.data.rows) {
      if (!existingByNo.has(row.employeeNo)) {
        passwordHashes.set(row.employeeNo, await hashPassword(row.employeeNo));
      }
    }

    await prisma.$transaction(async (tx) => {
      for (const row of parsed.data.rows) {
        const level = levelByNo.get(row.employeeNo) ?? null;
        const existing = existingByNo.get(row.employeeNo);

        if (existing) {
          await tx.user.update({
            where: { id: existing.id },
            data: {
              fullName: row.name,
              employeeNo: row.employeeNo,
              hireDate: row.hireDate ? new Date(row.hireDate) : undefined,
            },
          });
          results.push({ employeeNo: row.employeeNo, name: row.name, level: level ?? '—', created: false });
        } else {
          await tx.user.create({
            data: {
              contact: row.employeeNo,
              passwordHash: passwordHashes.get(row.employeeNo)!,
              fullName: row.name,
              employeeNo: row.employeeNo,
              hireDate: row.hireDate ? new Date(row.hireDate) : undefined,
            },
          });
          results.push({ employeeNo: row.employeeNo, name: row.name, level: level ?? '—', created: true });
        }
      }
    });

    return NextResponse.json({ success: true, results });
  } catch (e) {
    console.error('POST /api/admin/users/import:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
