// 表单模板 CRUD（创建/编辑/发布/归档/删除）
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { ensureScoreOptionIds } from '@/lib/form-options';

// ---- Validation schemas ----

const HeaderFieldSchema = z.object({
  key: z.enum(['workArea', 'hireDate', 'declarationLevel', 'declarationSpecialty']),
  enabled: z.boolean(),
  required: z.boolean(),
});

const ScoreOptionSchema = z.object({
  optionId: z.string().optional(),
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
  scoreMode: z.enum(['TIERS', 'COUNTED']).default('TIERS'),
  maxScore: z.number().min(0).max(1000).optional().nullable(),
  scoreOptions: z.array(ScoreOptionSchema).min(1, '申报项至少需要一个分值档次'),
  sortOrder: z.number().int().default(0),
}).refine((it) => it.scoreMode !== 'COUNTED' || (it.maxScore != null && it.maxScore > 0), {
  message: '按次数计分的申报项必须设置大于 0 的上限分',
  path: ['maxScore'],
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
  headerFields: z.array(HeaderFieldSchema).optional(),
  sections: z.array(SectionSchema).min(1, '模板至少需要一个章节'),
});

const PublishSchema = z.object({
  id: z.string(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
});

// 文字修订：仅改文案，不改结构与分值（用于已发布且有申报的模板纠错别字）
const TextOptionSchema = z.object({
  optionId: z.string().optional(),
  label: z.string().min(1),
  description: z.string().optional().nullable(),
});
const TextItemSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  hint: z.string().optional().nullable(),
  scoreOptions: z.array(TextOptionSchema),
});
const TextSectionSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  items: z.array(TextItemSchema),
});
const TextEditSchema = z.object({
  id: z.string(),
  mode: z.literal('text'),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  sections: z.array(TextSectionSchema),
});

// ---- State-machine transition rules ----

const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['PUBLISHED'],
  PUBLISHED: ['ARCHIVED'],
  ARCHIVED: [], // terminal — cannot transition to any other state
};

function normalizeSectionsForWrite(sections: z.infer<typeof SectionSchema>[]) {
  return sections.map((s) => ({
    title: s.title,
    description: s.description,
    sortOrder: s.sortOrder,
    items: {
      create: s.items.map((it) => ({
        ...it,
        scoreOptions: ensureScoreOptionIds(it.scoreOptions) as any,
      })),
    },
  }));
}

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
      console.error('POST TemplateSchema validation failed:', JSON.stringify(parsed.error.issues, null, 2));
      return NextResponse.json({ error: '参数无效', issues: parsed.error.issues }, { status: 400 });
    }
    const { year, title, description, sections, headerFields } = parsed.data;

    const tpl = await prisma.formTemplate.create({
      data: {
        year, title, description, createdBy: session.userId,
        headerFields: headerFields as any,
        sections: {
          create: normalizeSectionsForWrite(sections),
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

    // 文字修订模式：仅改文案，允许已发布且有申报的模板执行（不影响已归档快照）
    if (body.mode === 'text') {
      return await handleTextEdit(body);
    }

    const parsed = TemplateSchema.safeParse(body);
    if (!parsed.success) {
      console.error('PUT TemplateSchema validation failed:', JSON.stringify(parsed.error.issues, null, 2));
      return NextResponse.json({ error: '参数无效', issues: parsed.error.issues }, { status: 400 });
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

    const { year, title, description, sections, headerFields } = parsed.data;

    // Replace sections atomically: delete old tree, recreate from payload.
    await prisma.formSection.deleteMany({ where: { templateId: id } });

    const tpl = await prisma.formTemplate.update({
      where: { id },
      data: {
        year, title, description,
        headerFields: headerFields as any,
        sections: {
          create: normalizeSectionsForWrite(sections),
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

/**
 * Text-only revision: fix typos in titles/descriptions/hints/option labels
 * WITHOUT touching structure (no add/remove of sections/items/options) or scores.
 * Allowed on PUBLISHED templates even with submissions — archived snapshots in
 * PerformanceRecord are independent copies and remain unchanged.
 */
async function handleTextEdit(body: unknown) {
  const parsed = TextEditSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '参数无效' }, { status: 400 });
  }
  const { id, title, description, sections } = parsed.data;

  const existing = await prisma.formTemplate.findUnique({
    where: { id },
    include: { sections: { include: { items: true } } },
  });
  if (!existing) {
    return NextResponse.json({ error: '模板不存在' }, { status: 404 });
  }
  if (existing.status === 'ARCHIVED') {
    return NextResponse.json({ error: '已归档模板不可编辑' }, { status: 409 });
  }

  // 结构必须完全一致：章节、申报项、分值档次数量与 id 都不可变
  const existingSectionIds = new Set(existing.sections.map((s) => s.id));
  if (sections.length !== existing.sections.length ||
      !sections.every((s) => existingSectionIds.has(s.id))) {
    return NextResponse.json({ error: '文字修订不可增删章节，请使用「复制为草稿」调整结构' }, { status: 400 });
  }
  for (const sec of sections) {
    const exSec = existing.sections.find((s) => s.id === sec.id)!;
    const exItemIds = new Set(exSec.items.map((it) => it.id));
    if (sec.items.length !== exSec.items.length ||
        !sec.items.every((it) => exItemIds.has(it.id))) {
      return NextResponse.json({ error: '文字修订不可增删申报项，请使用「复制为草稿」调整结构' }, { status: 400 });
    }
    for (const it of sec.items) {
      const exItem = exSec.items.find((x) => x.id === it.id)!;
      const exOptions = Array.isArray(exItem.scoreOptions) ? (exItem.scoreOptions as unknown[]) : [];
      if (it.scoreOptions.length !== exOptions.length) {
        return NextResponse.json({ error: '文字修订不可增删分值档次，请使用「复制为草稿」调整结构' }, { status: 400 });
      }
    }
  }

  // 逐条更新文字字段，分值保持原值
  try {
    await prisma.$transaction(async (tx) => {
      await tx.formTemplate.update({
        where: { id },
        data: { title, description: description ?? null },
      });
      for (const sec of sections) {
        await tx.formSection.update({
          where: { id: sec.id },
          data: { title: sec.title, description: sec.description ?? null },
        });
        const exSec = existing.sections.find((s) => s.id === sec.id)!;
        for (const it of sec.items) {
          const exItem = exSec.items.find((x) => x.id === it.id)!;
          const exOptions = (exItem.scoreOptions as Array<{ optionId?: string; score: number }>);
          const mergedOptions = it.scoreOptions.map((o, idx) => ({
            optionId: exOptions[idx]?.optionId,
            label: o.label,
            score: exOptions[idx]?.score ?? 0, // 保留原分值
            description: o.description ?? undefined,
          }));
          await tx.formItem.update({
            where: { id: it.id },
            data: {
              title: it.title,
              hint: it.hint ?? null,
              scoreOptions: mergedOptions as any,
            },
          });
        }
      }
    });
  } catch (e) {
    console.error('PUT(text) /api/admin/templates:', e);
    return NextResponse.json({ error: '文字修订失败' }, { status: 500 });
  }
  return NextResponse.json({ success: true, id });
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
      include: { sections: { include: { items: { include: { optionReviewers: true } } } } },
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

    if (newStatus === 'PUBLISHED') {
      const missing = current.sections.flatMap((section) =>
        section.items.flatMap((item) => {
          const assigned = new Set(item.optionReviewers.map((reviewer) => reviewer.optionId));
          const options = Array.isArray(item.scoreOptions) ? item.scoreOptions as Array<{ optionId?: string; label?: string }> : [];
          return options
            .map((option, index) => ({
              label: option.label || `第 ${index + 1} 个子项`,
              optionId: option.optionId || `${item.id}:${index}`,
            }))
            .filter((option) => !assigned.has(option.optionId))
            .map((option) => `${section.title} / ${item.title} / ${option.label}`);
        }),
      );
      if (missing.length > 0) {
        return NextResponse.json({
          error: `以下申报子项尚未配置二级审核部门：${missing.join('、')}`,
          code: 'MISSING_OPTION_REVIEWERS',
        }, { status: 409 });
      }
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
