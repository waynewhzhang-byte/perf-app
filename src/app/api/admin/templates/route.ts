// 表单模板 CRUD（创建/编辑/发布/归档/删除）
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';

// ---- Validation schemas ----

const ScoreOptionSchema = z.object({
  label: z.string().min(1, '分值档次名称不能为空'),
  score: z.number().min(-100, '分值超出范围').max(100, '分值超出范围'),
  description: z.string().optional(),
});

const ItemSchema = z.object({
  title: z.string().min(1),
  hint: z.string().optional(),
  isRequired: z.boolean().default(false),
  requireAttachment: z.boolean().default(false),
  maxSelections: z.number().int().min(1).default(1),
  scoreOptions: z.array(ScoreOptionSchema).min(1, '申报项至少需要一个分值档次'),
  sortOrder: z.number().int().default(0),
});

const SectionSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  sortOrder: z.number().int().default(0),
  items: z.array(ItemSchema).min(1, '章节至少需要一个申报项'),
});

const TemplateSchema = z.object({
  year: z.number().int().min(2000, '年份无效').max(2100, '年份无效'),
  title: z.string().min(1),
  description: z.string().optional(),
  sections: z.array(SectionSchema).min(1, '模板至少需要一个章节'),
});

const PublishSchema = z.object({
  id: z.string(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
});

// ---- State-machine transition rules ----

const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['PUBLISHED'],
  PUBLISHED: ['ARCHIVED'],
  ARCHIVED: [], // terminal — cannot transition to any other state
};

// ---- Handlers ----

export async function GET() {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const templates = await prisma.formTemplate.findMany({
      include: {
        sections: {
          include: { items: { orderBy: { sortOrder: 'asc' } } },
          orderBy: { sortOrder: 'asc' },
        },
        _count: { select: { submissions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ success: true, templates });
  } catch (e) {
    console.error('GET /api/admin/templates:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const parsed = TemplateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: '参数无效' }, { status: 400 });
    }
    const { year, title, description, sections } = parsed.data;

    const tpl = await prisma.formTemplate.create({
      data: {
        year, title, description, createdBy: session.userId,
        sections: {
          create: sections.map((s) => ({
            title: s.title, description: s.description, sortOrder: s.sortOrder,
            items: { create: s.items },
          })),
        },
      },
    });
    return NextResponse.json({ success: true, id: tpl.id });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      return NextResponse.json({ error: '创建失败' }, { status: 400 });
    }
    console.error('POST /api/admin/templates:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

/** Edit an existing draft template (full content replacement). */
export async function PUT(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const body = await req.json();
    const id: string | undefined = body.id;
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: '缺少模板 ID' }, { status: 400 });
    }

    const parsed = TemplateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: '参数无效' }, { status: 400 });
    }

    // Verify existence before the update to produce a clean 404.
    const existing = await prisma.formTemplate.findUnique({
      where: { id },
      include: { _count: { select: { submissions: true } } },
    });
    if (!existing) {
      return NextResponse.json({ error: '模板不存在' }, { status: 404 });
    }
    if (existing.status === 'ARCHIVED') {
      return NextResponse.json({ error: '已归档模板不可编辑' }, { status: 409 });
    }
    if (existing._count.submissions > 0) {
      return NextResponse.json({
        error: '该模板已有员工申报，无法直接修改结构。请使用「复制为草稿」创建新版本后再编辑。',
        code: 'HAS_SUBMISSIONS',
      }, { status: 409 });
    }

    const { year, title, description, sections } = parsed.data;

    // Replace sections atomically: delete old tree, recreate from payload.
    await prisma.formSection.deleteMany({ where: { templateId: id } });

    const tpl = await prisma.formTemplate.update({
      where: { id },
      data: {
        year, title, description,
        sections: {
          create: sections.map((s) => ({
            title: s.title, description: s.description, sortOrder: s.sortOrder,
            items: { create: s.items },
          })),
        },
      },
    });
    return NextResponse.json({ success: true, id: tpl.id });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2025') return NextResponse.json({ error: '模板不存在' }, { status: 404 });
      return NextResponse.json({ error: '更新失败' }, { status: 400 });
    }
    console.error('PUT /api/admin/templates:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

/** Publish / archive status transitions with state-machine validation. */
export async function PATCH(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const parsed = PublishSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: '参数无效' }, { status: 400 });
    }

    const { id, status: newStatus } = parsed.data;

    // Read current status to validate the transition.
    const current = await prisma.formTemplate.findUnique({
      where: { id },
      select: { status: true, publishedAt: true },
    });
    if (!current) {
      return NextResponse.json({ error: '模板不存在' }, { status: 404 });
    }

    const allowed = VALID_TRANSITIONS[current.status];
    if (!allowed.includes(newStatus)) {
      return NextResponse.json({
        error: `不允许从 ${current.status} 转换为 ${newStatus}`,
      }, { status: 409 });
    }

    // Preserve original publish timestamp on archive.
    const publishedAt =
      newStatus === 'PUBLISHED'  ? new Date()          // freshly published
    : newStatus === 'ARCHIVED'   ? current.publishedAt  // retain original publish time
    : null;                                              // transition to DRAFT clears it

    await prisma.formTemplate.update({
      where: { id },
      data: { status: newStatus, publishedAt },
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2025') return NextResponse.json({ error: '模板不存在' }, { status: 404 });
      return NextResponse.json({ error: '状态更新失败' }, { status: 400 });
    }
    console.error('PATCH /api/admin/templates:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const body = await req.json();
    const id: string | undefined = body.id;
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: '缺少模板 ID' }, { status: 400 });
    }

    const existing = await prisma.formTemplate.findUnique({
      where: { id },
      include: { _count: { select: { submissions: true } } },
    });
    if (!existing) {
      return NextResponse.json({ error: '模板不存在' }, { status: 404 });
    }
    if (existing._count.submissions > 0) {
      return NextResponse.json({
        error: '该模板已有员工申报，无法删除。请先归档模板。',
        code: 'HAS_SUBMISSIONS',
      }, { status: 409 });
    }

    await prisma.formTemplate.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2025') return NextResponse.json({ error: '模板不存在' }, { status: 404 });
      return NextResponse.json({ error: '删除失败' }, { status: 400 });
    }
    console.error('DELETE /api/admin/templates:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
