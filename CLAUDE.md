# 企业员工绩效申报系统 — CLAUDE.md

## 技术栈

| 层 | 选型 |
|---|------|
| 框架 | Next.js 14 (App Router, React 18) |
| 语言 | TypeScript 5.6 (`strict: true`) |
| ORM | Prisma 5.22 (PostgreSQL 16) |
| 对象存储 | MinIO (S3 兼容，`minio` SDK) |
| 认证 | JWT (`jose`)，双 Cookie（`perf_session` / `perf_session_admin`） |
| 样式 | Tailwind CSS 3.4 |
| 校验 | Zod 3 |
| 密码 | bcryptjs |
| 通知 | 阿里云短信 (HMAC-SHA1 签名) + SMTP 邮件 (nodemailer) |
| 导出 | archiver 流式 ZIP |

## 项目文件架构

```
src/
├── app/                          # Next.js App Router（全部页面 + API）
│   ├── layout.tsx                # 根布局（zh-CN, slate-50 背景）
│   ├── page.tsx                  # 入口选择页（员工/管理员双入口）
│   ├── login/page.tsx            # 员工登录 → /api/auth/login
│   ├── register/page.tsx         # 员工注册 → /api/auth/register
│   ├── forgot/page.tsx           # 找回密码
│   ├── app/                      # 员工端路由
│   │   ├── page.tsx              # 我的申报（SSR：已发布表单 + 历史记录）
│   │   ├── submission/[templateId]/page.tsx  # 填报页（客户端：章节渲
│   │   └── review/page.tsx       # 审核工作台（客户端：逐项通过/驳回）
│   ├── admin/                    # 管理端路由
│   │   ├── setup/page.tsx        # 首次管理员引导（仅无 ADMIN 时可访问）
│   │   ├── login/page.tsx        # 管理员登录 → /api/auth/login?admin=1
│   │   ├── page.tsx              # 管理后台首页（SSR：统计 + 导航卡片）
│   │   ├── notify/page.tsx       # 通知渠道配置（客户端）
│   │   ├── templates/page.tsx    # 申报表设计器（客户端：章节+申报项编辑器）
│   │   ├── users/page.tsx        # 用户列表与角色分配
│   │   ├── organization/page.tsx # 组织架构管理（分公司/部门/岗位/工种）
│   │   └── export/page.tsx       # 数据导出（按分公司+年度 ZIP）
│   └── api/                      # REST API（全部 Next.js Route Handlers）
│       ├── setup/route.ts        # GET 检查是否需要引导 / POST 创建首个 ADMIN
│       ├── auth/
│       │   ├── login/route.ts    # 双入口登录（?admin=1 走 admin cookie）
│       │   ├── logout/route.ts   # 清除会话
│       │   ├── register/route.ts # 注册（验证码 + 创建 EMPLOYEE）
│       │   ├── send-code/route.ts# 发送 6 位验证码（60s 限频，5min 有效期）
│       │   └── reset-password/route.ts  # 重置密码
│       ├── submissions/route.ts  # GET 我的申报 / POST 创建/更新 + 提交
│       ├── review/route.ts       # GET 待审列表 / POST 逐项审核决策
│       ├── attachments/route.ts  # POST 上传到 MinIO / DELETE 删除
│       └── admin/
│           ├── templates/route.ts      # CRUD + 发布/下架
│           ├── organization/route.ts   # 分公司/部门/岗位/工种 CRUD
│           ├── users/route.ts          # 用户列表 + 角色分配
│           ├── notify-config/route.ts  # GET/PUT 通知渠道配置
│           └── export/route.ts         # 流式 ZIP 导出
├── lib/
│   ├── prisma.ts           # PrismaClient 单例（non-production 挂 globalThis）
│   ├── auth.ts             # JWT 签发/校验 + 双 Cookie 管理 + requireRole 守卫
│   ├── password.ts         # bcrypt 哈希/验证
│   ├── crypto.ts           # AES-256-GCM 加解密（保护通知渠道密钥）
│   ├── minio.ts            # MinIO 客户端 + bucket 自动创建 + put/get/presigned/remove
│   ├── export-zip.ts       # archiver 流式打包：manifest.csv + archive.json + 附件
│   └── notify/
│       ├── index.ts        # sendVerifyCode / sendNotice 统一入口
│       ├── aliyun-sms.ts   # 阿里云短信 POPv3 HMAC-SHA1 签名
│       └── smtp.ts         # SMTP 邮件发送（nodemailer）
└── components/             # 共享 UI 组件（当前为空，组件均内联在页面中）
```

## 技术架构

### 请求链路

```
浏览器 → Next.js Route Handler (API) → Prisma → PostgreSQL
                                    → MinIO SDK → MinIO
                                    → jose JWT verify
                                    → bcrypt compare
                                    → aliyun-sms / smtp
```

### 认证模型

- **双 Cookie 隔离**：`perf_session`（员工端）和 `perf_session_admin`（管理端）完全独立
- **JWT payload**: `{ userId, contact, fullName }`，HS256 签名，7 天过期
- **角色守卫**：`requireRole(role, isAdmin)` — 先验 JWT，再查 `user_roles` 表
- **角色体系**：`EMPLOYEE` → `REVIEWER_L1`（限定分公司） → `REVIEWER_L2`（总公司） → `ADMIN`

### 数据模型关键约束（见 `prisma/schema.prisma`）

- `NotifyConfig`: 单例模式，`id` 恒为 1
- `User.contact`: unique，根据系统配置存手机号或邮箱
- `UserRole`: 复合 unique `[userId, role, scopeBranchId]` — REVIEWER_L1 的 `scopeBranchId` 限定审核范围
- `Submission`: 复合 unique `[userId, templateId]` — 一人一个模板只能有一份申报
- `SubmissionItem`: 复合 unique `[submissionId, itemId]`
- `PerformanceRecord`: 复合 unique `[userId, year]` — 一人一年一条档案

### 通知渠道抽象

存储在数据库中的单一 `NotifyConfig` 记录（id=1），密钥以 AES-256-GCM 加密存储。运行时 `loadConfig()` 解密后路由到对应实现。管理员在后台切换渠道时实时生效，无需重启。

### 附件存储

- 上传路径：`submissions/{submissionId}/{itemId}/{uuid}-{filename}`
- Bucket 启动时自动创建（`ensureBucket()`）
- 导出时从 MinIO 流式读取 → archiver 直写 ZIP，不落盘

## 核心业务功能与边界

### 功能清单

| 模块 | 功能 | 入口 |
|------|------|------|
| 首次引导 | 创建首个超级管理员（仅系统无 ADMIN 时可用） | `/admin/setup` |
| 通知配置 | 阿里云短信 / SMTP 邮件切换，密钥 AES-256-GCM 加密存库 | `/admin/notify` |
| 组织架构 | 分公司 → 部门 / 岗位 / 工种 的 CRUD | `/admin/organization` |
| 表单模板 | 章节 → 申报项 → 分值档次 的层级结构，支持 DRAFT/PUBLISHED/ARCHIVED | `/admin/templates` |
| 用户管理 | 用户列表 + 角色分配（EMPLOYEE / REVIEWER_L1+L2） | `/admin/users` |
| 员工注册 | 验证码注册，自动获得 EMPLOYEE 角色 | `/register` |
| 绩效申报 | 选择已发布表单 → 逐项选择分值档次 + 文本备注 + 附件上传 → 草稿/提交 | `/app/submission/[id]` |
| 两级审核 | L1（分公司）逐项通过/驳回 → L2（总公司）终审 → 生成 PerformanceRecord | `/app/review` |
| 驳回重提 | 驳回后仅被驳回项可编辑，其余项锁定；重提后仅改动项再次审核 | `/app/submission/[id]` |
| 数据导出 | 按分公司+年度 ZIP 流式下载：manifest.csv + 每人 archive.json + 附件 | `/admin/export` |

### 业务边界与约束

- **通知渠道是全局单例**：一旦选择 SMS 或 EMAIL，所有用户注册/通知均使用该渠道。中途切换存在兼容性风险（已注册用户的联系方式类型变化）
- **审核员维度是分公司**：REVIEWER_L1 的 `scopeBranchId` 决定可见范围；REVIEWER_L2 无此限制，可审核所有 L1_APPROVED 的申报
- **申报不可并发修改**：一人一模板只有一份 Submission，upsert 语义决定了后来的总是覆盖
- **归档是终态副本**：L2 全部通过后生成 `PerformanceRecord.archivedData`（JSON 快照），后续模板修改不影响已归档记录
- **附件不设大小限制**：MinIO 无限制（`serverActions.bodySizeLimit` 设为 20MB，影响 Server Action 但不影响 API Route 的 multipart 上传）

### 待扩展模块

- 表单设计器的可视化拖拽（当前为表单字段编辑 + JSON 配置）
- 审核员的复杂权限矩阵（当前为单维度「按分公司」）
- 国际化 / 移动端 UI 适配

## 开发命令

```bash
pnpm dev              # next dev（localhost:3000）
pnpm build            # next build
pnpm start            # next start（生产）
pnpm lint             # next lint（ESLint 8 + eslint-config-next）
pnpm prisma:generate  # 生成 Prisma Client
pnpm prisma:migrate   # prisma migrate dev（本地迁移）
pnpm prisma:studio    # Prisma Studio（数据库可视化）
```

### 基础设施

```bash
# 生成加密密钥
openssl rand -hex 32   # NOTIFY_SECRET_KEY
openssl rand -hex 32   # JWT_SECRET
```

## 环境变量（`.env`）

```
DATABASE_URL          — PostgreSQL 连接串
JWT_SECRET            — JWT 签名密钥（32 字节 hex）
NOTIFY_SECRET_KEY     — AES-256-GCM 加密密钥（32 字节 hex）
MINIO_ENDPOINT/PORT/USE_SSL/ACCESS_KEY/SECRET_KEY/BUCKET  — MinIO 服务端（同机用 127.0.0.1）
MINIO_PUBLIC_ENDPOINT/PORT/USE_SSL  — 预签名 URL 对外地址（可选）
APP_BASE_URL          — 应用 base URL（通知链接用）
COOKIE_SECURE         — 会话 Cookie Secure 覆盖；默认按 APP_BASE_URL 协议判断
```

## 编码约定

- **TypeScript strict mode**，所有 API 入参用 Zod schema 校验
- **API 响应统一为** `{ success, error?, ...data }` 或 `NextResponse.json(error, { status })`
- **身份校验模式**：每个 Route Handler 顶部 try-catch `requireRole` / `getSession`
- **Prisma 单例**：`globalThis.prisma` 避免 hot reload 时重复创建
- **组件内联**：当前无共享组件库，所有 UI 组件在页面文件中内联定义
- **Tailwind utility-first**：不使用 CSS modules，全部以 Tailwind 类名内联样式
- **无 ESLint 自定义配置**：使用 Next.js 默认 `eslint-config-next`
- **无 Prettier/格式化配置**：依赖编辑器默认行为
- **通知异步发**送：`sendNotice().catch(() => {})` 不阻塞主流程

## Agent skills

### Issue tracker

Issues live as GitHub issues in `waynewhzhang-byte/perf-app`. Use the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
