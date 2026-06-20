# 统一手工导入体系 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用卡片导航的统一手工导入体系替代一键流水线，支持员工档案（三层组织）+ 基本素质 + 两票/缺陷/安全四类评分事实的选择性上传与字段映射。

**Architecture:** `/admin/import` 改为 5 张导入项卡片的导航首页；每张卡指向一个极薄子页，子页共用 `<ImportWizard>` 四步表单组件（上传→映射→预览含试算→导入）。后端 5 个写入端点 + 1 个试算端点，评分全部复用现有 `computeFactScores` 与 DB `ScoringRule`。新增 `Team` 表支撑 工区→部门→班组 三层组织。

**Tech Stack:** Next.js 14 App Router、Prisma 5、xlsx、TypeScript；测试用 Node 内置 test runner（`npx tsx --test`），纯函数单测、API 路由靠手工/集成验证。

**Spec:** `docs/superpowers/specs/2026-06-21-manual-import-replacement-design.md`

**约定：**
- 测试命令：`npm test`（即 `npx tsx --test src/lib/*.test.ts`）。指定单文件用 `npx tsx --test src/lib/<file>.test.ts`。
- 迁移命令：`npm run prisma:migrate -- --name <name>`，生成后须 `npm run prisma:generate`。
- 测试风格：`import { describe, it } from 'node:test'; import assert from 'node:assert/strict';`，纯函数测试，不碰 DB。
- API 路由：`export { dynamic } from '@/lib/api-route';` + `requireAdmin()` 守卫，与现有路由一致。
- 纯函数库单测；API 路由不做单测（与现有代码库约定一致：defect/safety/ticket 计分函数有单测，route.ts 无单测）。

---

## 文件结构总览

**新建库（src/lib/，均含纯函数 + 单测）：**
- `team-org.ts` — 三层组织 ensure 计划构建（纯函数：行→组织计划）+ DB 写入函数
- `employee-import.ts` — 员工档案导入（纯函数：行→员工草稿；DB：User upsert + 组织 ensure）
- `basic-fact-import.ts` — 基本素质三维度（纯函数：行→三条事实草稿；DB：EmployeeBasicFact upsert）
- `manual-fact-import.ts` — 两票/缺陷/安全统一导入（复用 computeFactScores；DB：PerformanceFact upsert）
- `import-preview.ts` — 试算分发（纯函数：按 itemCode 调对应计分函数）

**新建 API 路由：**
- `src/app/api/admin/import/employees/route.ts`
- `src/app/api/admin/import/basic/route.ts`
- `src/app/api/admin/import/tickets/route.ts`
- `src/app/api/admin/import/defects/route.ts`
- `src/app/api/admin/import/safety/route.ts`
- `src/app/api/admin/import/preview/route.ts`

**新建前端：**
- `src/app/admin/import/_shared/types.ts` — ImportItemConfig / FieldSpec
- `src/app/admin/import/_shared/field-specs.ts` — 5 项配置
- `src/app/admin/import/_shared/parse.ts` — parseCSV/parseXLSX（从 legacy 抽出）
- `src/app/admin/import/_shared/ImportWizard.tsx` — 四步表单
- `src/app/admin/import/{employees,basic,tickets,defects,safety}/page.tsx` — 5 个极薄子页

**改造/删除：**
- 改造 `src/app/admin/import/page.tsx`（首页→卡片墙）
- 删除 `src/app/admin/import/legacy/page.tsx`
- 删除 `src/app/api/admin/import/route.ts`（legacy 单维度）
- schema 加 `Team` 模型 + `User.teamId`

---

## Task 1: 新增 Team 表与 User.teamId（数据库迁移）

**Files:**
- Modify: `prisma/schema.prisma`（User 模型 + 新增 Team 模型 + Department 模型加反向关系）

- [ ] **Step 1: 修改 schema — Department 加反向关系**

在 `prisma/schema.prisma` 的 `Department` 模型（约 159–169 行）的 relations 区加：

```prisma
  teams  Team[]
```

完整模型变为：

```prisma
model Department {
  id        String   @id @default(cuid())
  branchId  String
  name      String
  createdAt DateTime @default(now())

  branch Branch @relation(fields: [branchId], references: [id], onDelete: Cascade)
  users  User[]
  teams  Team[]
  optionReviewers FormOptionReviewer[]
  submissionOptionReviews SubmissionOptionReview[]
}
```

- [ ] **Step 2: 修改 schema — User 加 teamId**

在 `User` 模型（约 61 行起）的 `departmentId` 下方加字段，relations 区加关系：

```prisma
  departmentId    String?
  teamId          String?
```

relations 区（`department` 下方）加：

```prisma
  team            Team?          @relation(fields: [teamId], references: [id])
```

并在 `User` 的 relations 末尾（`employeeBasicFacts` 后）加：

```prisma
  team             Team?
```

- [ ] **Step 3: 修改 schema — 新增 Team 模型**

在 `Department` 模型之后插入：

```prisma
model Team {
  id           String   @id @default(cuid())
  departmentId String
  name         String
  createdAt    DateTime @default(now())

  department Department @relation(fields: [departmentId], references: [id], onDelete: Cascade)
  users      User[]

  @@unique([departmentId, name])
  @@index([departmentId])
}
```

- [ ] **Step 4: 生成迁移并应用**

Run:
```bash
npm run prisma:migrate -- --name add_team
```
Expected: 生成 `prisma/migrations/<ts>_add_team/migration.sql`，含 `CREATE TABLE "Team"`、`ALTER TABLE "User" ADD COLUMN "teamId"`、外键与唯一约束；命令成功无报错。

- [ ] **Step 5: 重新生成 Prisma Client**

Run:
```bash
npm run prisma:generate
```
Expected: 输出 `✔ Generated Prisma Client`，无类型错误。

- [ ] **Step 6: 提交**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(db): 新增 Team 表与 User.teamId(三层组织 工区/部门/班组)"
```

---

## Task 2: 三层组织计划构建（纯函数 team-org.ts）

本任务实现"由映射后的员工行 → 三层组织 ensure 计划"的纯函数，先于 DB 写入。这样 DB 写入与计划构建可独立单测。

**Files:**
- Create: `src/lib/team-org.ts`
- Test: `src/lib/team-org.test.ts`

- [ ] **Step 1: 写失败测试**

Create `src/lib/team-org.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildThreeTierOrgPlan } from './team-org';

describe('buildThreeTierOrgPlan', () => {
  it('聚合 工区/部门/班组 三层（班组可空）', () => {
    const plan = buildThreeTierOrgPlan([
      { workArea: '晋北运维分部', department: '变电运维一班', team: '一次班' },
      { workArea: '晋北运维分部', department: '变电运维一班', team: '二次班' },
      { workArea: '公司总部', department: '运维检修部', team: '' },
      { workArea: '晋北运维分部', department: '变电运维一班', team: '一次班' }, // 重复去重
    ]);
    assert.deepEqual(plan.workAreas, ['公司总部', '晋北运维分部']);
    assert.deepEqual(plan.departments, [
      { workArea: '晋北运维分部', name: '变电运维一班' },
      { workArea: '公司总部', name: '运维检修部' },
    ]);
    assert.deepEqual(plan.teams, [
      { workArea: '晋北运维分部', department: '变电运维一班', name: '一次班' },
      { workArea: '晋北运维分部', department: '变电运维一班', name: '二次班' },
    ]);
  });

  it('空工区行被跳过', () => {
    const plan = buildThreeTierOrgPlan([
      { workArea: '', department: 'X', team: '' },
      { workArea: '晋北运维分部', department: 'D', team: '' },
    ]);
    assert.deepEqual(plan.workAreas, ['晋北运维分部']);
    assert.deepEqual(plan.departments, [{ workArea: '晋北运维分部', name: 'D' }]);
    assert.deepEqual(plan.teams, []);
  });

  it('部门为空时仅建工区，不建部门/班组', () => {
    const plan = buildThreeTierOrgPlan([
      { workArea: '晋北运维分部', department: '', team: 'T' },
    ]);
    assert.deepEqual(plan.workAreas, ['晋北运维分部']);
    assert.deepEqual(plan.departments, []);
    assert.deepEqual(plan.teams, []);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx tsx --test src/lib/team-org.test.ts`
Expected: FAIL — `Cannot find module './team-org'`。

- [ ] **Step 3: 实现 team-org.ts**

Create `src/lib/team-org.ts`:

```typescript
/**
 * 三层组织架构（工区 → 部门 → 班组）导入支持。
 *
 * 与旧 org-mapping.ts 的区别：不再用正则猜测哪个是工区，
 * 而是直接使用导入时用户映射出的 工区/部门/班组 三列。
 */

/** 映射并标准化后的员工组织行（来自 ImportWizard 的 mapping） */
export interface OrgRow {
  /** 工区（Branch），必填 */
  workArea: string;
  /** 部门（Department），可空 */
  department: string;
  /** 班组（Team），可空 */
  team: string;
}

export interface ThreeTierOrgPlan {
  /** 需 ensure 的工区名（去重、排序） */
  workAreas: string[];
  /** 需 ensure 的部门（挂在工区下，去重、排序） */
  departments: { workArea: string; name: string }[];
  /** 需 ensure 的班组（挂在部门下，去重、排序） */
  teams: { workArea: string; department: string; name: string }[];
}

const norm = (s: unknown): string => (s == null ? '' : String(s).trim());

/**
 * 由员工行聚合三层组织 ensure 计划。
 * 规则：工区为空 → 整行跳过；部门为空 → 仅记工区；班组为空 → 仅记工区+部门。
 */
export function buildThreeTierOrgPlan(rows: OrgRow[]): ThreeTierOrgPlan {
  const workAreaSet = new Set<string>();
  const deptSet = new Set<string>();
  const teamSet = new Set<string>();

  for (const r of rows) {
    const workArea = norm(r.workArea);
    if (!workArea) continue;
    workAreaSet.add(workArea);

    const department = norm(r.department);
    if (!department) continue;
    deptSet.add(`${workArea}\0${department}`);

    const team = norm(r.team);
    if (!team) continue;
    teamSet.add(`${workArea}\0${department}\0${team}`);
  }

  const zh = (a: string, b: string) => a.localeCompare(b, 'zh-CN');
  return {
    workAreas: [...workAreaSet].sort(zh),
    departments: [...deptSet]
      .map((k) => {
        const [workArea, name] = k.split('\0');
        return { workArea, name };
      })
      .sort((a, b) => zh(a.workArea, b.workArea) || zh(a.name, b.name)),
    teams: [...teamSet]
      .map((k) => {
        const [workArea, department, name] = k.split('\0');
        return { workArea, department, name };
      })
      .sort((a, b) =>
        zh(a.workArea, b.workArea) || zh(a.department, b.department) || zh(a.name, b.name)),
  };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx tsx --test src/lib/team-org.test.ts`
Expected: PASS（3 tests）。

- [ ] **Step 5: 提交**

```bash
git add src/lib/team-org.ts src/lib/team-org.test.ts
git commit -m "feat(org): 三层组织计划构建纯函数 buildThreeTierOrgPlan"
```

---

## Task 3: 三层组织 DB 写入（team-org.ts 续）

在 team-org.ts 中追加 DB ensure 函数。DB 写入不做单测（约定），但依赖 Task 2 已测的纯函数。

**Files:**
- Modify: `src/lib/team-org.ts`（追加 `ensureThreeTierOrg`）

- [ ] **Step 1: 追加 ensureThreeTierOrg 函数**

在 `src/lib/team-org.ts` 末尾追加：

```typescript
import type { PrismaClient } from '@prisma/client';

/** 三层组织 id 查找表（ensure 后返回，供员工导入关联） */
export interface ThreeTierOrgLookup {
  branchIdByWorkArea: Map<string, string>;
  departmentIdByKey: Map<string, string>; // key = `${workArea}\0${department}`
  teamIdByKey: Map<string, string>;       // key = `${workArea}\0${department}\0${team}`
}

const deptKey = (workArea: string, department: string) => `${workArea}\0${department}`;
const teamKey = (workArea: string, department: string, team: string) =>
  `${workArea}\0${department}\0${team}`;

/**
 * 确保三层组织存在（缺则建），返回 id 查找表。
 * 沿用现有 ensureOrgStructure 的 upsert-by-findFirst 模式。
 */
export async function ensureThreeTierOrg(
  prisma: PrismaClient,
  plan: ThreeTierOrgPlan,
): Promise<ThreeTierOrgLookup> {
  const branchIdByWorkArea = new Map<string, string>();
  const departmentIdByKey = new Map<string, string>();
  const teamIdByKey = new Map<string, string>();

  for (const name of plan.workAreas) {
    const existing = await prisma.branch.findFirst({ where: { name } });
    const branch = existing ?? (await prisma.branch.create({ data: { name } }));
    branchIdByWorkArea.set(name, branch.id);
  }

  for (const { workArea, name } of plan.departments) {
    const branchId = branchIdByWorkArea.get(workArea);
    if (!branchId) continue;
    const existing = await prisma.department.findFirst({ where: { branchId, name } });
    const dept = existing ?? (await prisma.department.create({ data: { branchId, name } }));
    departmentIdByKey.set(deptKey(workArea, name), dept.id);
  }

  for (const { workArea, department, name } of plan.teams) {
    const departmentId = departmentIdByKey.get(deptKey(workArea, department));
    if (!departmentId) continue;
    const existing = await prisma.team.findFirst({ where: { departmentId, name } });
    const team = existing ?? (await prisma.team.create({ data: { departmentId, name } }));
    teamIdByKey.set(teamKey(workArea, department, name), team.id);
  }

  return { branchIdByWorkArea, departmentIdByKey, teamIdByKey };
}

export { deptKey, teamKey };
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增类型错误（Team 已在 Task 1 生成）。若 `tsc` 不在项目，跳过本步（项目用 Next 编译）。

- [ ] **Step 3: 提交**

```bash
git add src/lib/team-org.ts
git commit -m "feat(org): ensureThreeTierOrg 三层组织 DB 写入"
```

---

## Task 4: 员工档案导入草稿构建（纯函数 employee-import.ts）

**Files:**
- Create: `src/lib/employee-import.ts`
- Test: `src/lib/employee-import.test.ts`

- [ ] **Step 1: 写失败测试**

Create `src/lib/employee-import.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildEmployeeDrafts } from './employee-import';

describe('buildEmployeeDrafts', () => {
  it('映射行 → 员工草稿（保留原始列到 profile）', () => {
    const drafts = buildEmployeeDrafts(
      {
        employeeNo: '工号', fullName: '姓名', workArea: '工区',
        department: '部门', team: '班组', position: '岗位', gender: '性别',
      },
      [
        { '工号': '001', '姓名': '张三', '工区': '晋北运维分部', '部门': '一班', '班组': '一次班', '岗位': '班长', '性别': '男', '电话': '13800' },
        { '工号': '002', '姓名': '李四', '工区': '公司总部', '部门': '', '班组': '', '岗位': '', '性别': '' },
      ],
    );
    assert.equal(drafts.length, 2);
    assert.equal(drafts[0].employeeNo, '001');
    assert.equal(drafts[0].workArea, '晋北运维分部');
    assert.equal(drafts[0].profile.电话, '13800'); // 未映射的原始列进 profile
    assert.equal(drafts[1].workArea, '公司总部');
    assert.equal(drafts[1].department, '');
  });

  it('工号或姓名缺失的行被跳过', () => {
    const drafts = buildEmployeeDrafts(
      { employeeNo: '工号', fullName: '姓名', workArea: '工区', department: '部门', team: '班组', position: '岗位', gender: '性别' },
      [
        { '工号': '', '姓名': '无名', '工区': 'X', '部门': '', '班组': '', '岗位': '', '性别': '' },
        { '工号': '003', '姓名': '', '工区': 'X', '部门': '', '班组': '', '岗位': '', '性别': '' },
      ],
    );
    assert.equal(drafts.length, 0);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx tsx --test src/lib/employee-import.test.ts`
Expected: FAIL — `Cannot find module './employee-import'`。

- [ ] **Step 3: 实现 employee-import.ts（草稿部分）**

Create `src/lib/employee-import.ts`:

```typescript
/**
 * 员工档案与三层组织导入。
 *
 * 分两层：
 * - buildEmployeeDrafts（纯函数）：映射后的行 → 员工草稿（含组织字段 + profile 原始列）
 * - importEmployees（DB）：ensure 组织 + User upsert
 *
 * 与旧 basic-quality-import.ts 区别：组织字段直接来自用户映射列，
 * 不再用 org-mapping 硬拆字符串。
 */
import type { PrismaClient } from '@prisma/client';
import {
  buildThreeTierOrgPlan,
  ensureThreeTierOrg,
  deptKey,
  teamKey,
  type ThreeTierOrgLookup,
} from './team-org';

/** 员工导入字段映射（系统字段 key → 文件列头） */
export interface EmployeeFieldMapping {
  employeeNo: string;
  fullName: string;
  workArea: string;
  department: string;
  team: string;
  position: string;
  gender: string;
}

export interface EmployeeDraft {
  employeeNo: string;
  fullName: string;
  workArea: string;
  department: string;
  team: string;
  position: string;
  gender: string;
  /** 未映射的原始列快照 */
  profile: Record<string, string>;
}

const norm = (s: unknown): string => (s == null ? '' : String(s).trim());

/** 由映射 + 原始行生成员工草稿；工号或姓名缺失跳过 */
export function buildEmployeeDrafts(
  mapping: EmployeeFieldMapping,
  rows: Record<string, string>[],
): EmployeeDraft[] {
  const mappedKeys = new Set(Object.values(mapping));
  const drafts: EmployeeDraft[] = [];
  for (const row of rows) {
    const employeeNo = norm(row[mapping.employeeNo]);
    const fullName = norm(row[mapping.fullName]);
    if (!employeeNo || !fullName) continue;
    // 未被映射的列 → profile 快照
    const profile: Record<string, string> = {};
    for (const [col, val] of Object.entries(row)) {
      if (!mappedKeys.has(col) && norm(val)) profile[col] = norm(val);
    }
    drafts.push({
      employeeNo,
      fullName,
      workArea: norm(row[mapping.workArea]),
      department: norm(row[mapping.department]),
      team: norm(row[mapping.team]),
      position: norm(row[mapping.position]),
      gender: norm(row[mapping.gender]),
      profile,
    });
  }
  return drafts;
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx tsx --test src/lib/employee-import.test.ts`
Expected: PASS（2 tests）。

- [ ] **Step 5: 提交**

```bash
git add src/lib/employee-import.ts src/lib/employee-import.test.ts
git commit -m "feat(import): 员工档案草稿构建 buildEmployeeDrafts"
```

---

## Task 5: 员工档案 DB 导入（importEmployees）

**Files:**
- Modify: `src/lib/employee-import.ts`（追加 `importEmployees`）

- [ ] **Step 1: 追加 importEmployees + 位置 ensure**

在 `src/lib/employee-import.ts` 末尾追加：

```typescript
/** 位置缓存（避免逐行 findFirst） */
async function ensurePosition(
  prisma: PrismaClient,
  name: string,
  cache: Map<string, string>,
): Promise<string | null> {
  if (!name) return null;
  const hit = cache.get(name);
  if (hit) return hit;
  const existing = await prisma.position.findFirst({ where: { name } });
  const pos = existing ?? (await prisma.position.create({ data: { name } }));
  cache.set(name, pos.id);
  return pos.id;
}

export interface EmployeeImportResult {
  total: number;
  usersCreated: number;
  usersUpdated: number;
  orgPlan: ReturnType<typeof buildThreeTierOrgPlan>;
}

/**
 * 导入员工档案：先 ensure 三层组织，再逐行 User upsert。
 * @param prisma  PrismaClient
 * @param mapping 字段映射
 * @param rows    原始行
 * @param sourceFile 源文件名（写入 profile 不直接落库此字段，保留供日志）
 */
export async function importEmployees(
  prisma: PrismaClient,
  mapping: EmployeeFieldMapping,
  rows: Record<string, string>[],
  sourceFile: string,
): Promise<EmployeeImportResult> {
  const drafts = buildEmployeeDrafts(mapping, rows);
  const orgPlan = buildThreeTierOrgPlan(drafts);
  const lookup = await ensureThreeTierOrg(prisma, orgPlan);
  const positionCache = new Map<string, string>();

  let usersCreated = 0;
  let usersUpdated = 0;

  for (const d of drafts) {
    const branchId = d.workArea ? lookup.branchIdByWorkArea.get(d.workArea) ?? null : null;
    let departmentId: string | null = null;
    if (d.workArea && d.department) {
      departmentId = lookup.departmentIdByKey.get(deptKey(d.workArea, d.department)) ?? null;
    }
    let teamId: string | null = null;
    if (d.workArea && d.department && d.team) {
      teamId = lookup.teamIdByKey.get(teamKey(d.workArea, d.department, d.team)) ?? null;
    }
    const positionId = await ensurePosition(prisma, d.position, positionCache);

    const existing = await prisma.user.findFirst({
      where: { employeeNo: d.employeeNo },
      select: { id: true },
    });

    const userData = {
      fullName: d.fullName,
      employeeNo: d.employeeNo,
      gender: d.gender || null,
      branchId,
      departmentId,
      teamId,
      positionId,
      profile: d.profile as object,
    };

    if (existing) {
      await prisma.user.update({ where: { id: existing.id }, data: userData });
      usersUpdated++;
    } else {
      await prisma.user.create({
        data: { contact: d.employeeNo, passwordHash: '', ...userData },
      });
      usersCreated++;
    }
  }

  // sourceFile 保留参数供 FactImportLog 记录（路由层使用），此处不直接落库
  void sourceFile;

  return { total: drafts.length, usersCreated, usersUpdated, orgPlan };
}
```

- [ ] **Step 2: 确认现有测试仍通过**

Run: `npx tsx --test src/lib/employee-import.test.ts`
Expected: PASS（纯函数测试不受 DB 函数影响）。

- [ ] **Step 3: 提交**

```bash
git add src/lib/employee-import.ts
git commit -m "feat(import): importEmployees 三层组织 + User upsert"
```

---

## Task 6: 基本素质三维度草稿构建（纯函数 basic-fact-import.ts）

**Files:**
- Create: `src/lib/basic-fact-import.ts`
- Test: `src/lib/basic-fact-import.test.ts`

- [ ] **Step 1: 写失败测试**

Create `src/lib/basic-fact-import.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildBasicFactDrafts, type BasicFactFieldMapping } from './basic-fact-import';

const mapping: BasicFactFieldMapping = {
  employeeNo: '工号', fullName: '姓名', skill: '技能等级', title: '职称等级',
  perf2023: '2023', perf2024: '2024', perf2025: '2025',
};

describe('buildBasicFactDrafts', () => {
  it('一行 → 三条事实（技能/职称/绩效），绩效按三年组合计分', () => {
    const drafts = buildBasicFactDrafts(
      mapping,
      [{ '工号': '001', '姓名': '张三', '技能等级': '技师', '职称等级': '中级', '2023': 'A', '2024': 'B', '2025': 'B' }],
      2025,
      { skill: { 技师: 3 }, title: { 中级: 3 }, performance: { '2A1B': 5.5, '1A2B': 5 } },
    );
    assert.equal(drafts.length, 3);
    const byDim = Object.fromEntries(drafts.map((d) => [d.dimension, d]));
    assert.equal(byDim.SKILL_LEVEL.score, 3);
    assert.equal(byDim.TITLE_LEVEL.score, 3);
    // [A,B,B] → 1A2B → 5
    assert.equal(byDim.PERFORMANCE_LEVEL.score, 5);
    assert.equal(byDim.PERFORMANCE_LEVEL.tierValue, '1A2B');
    assert.deepEqual(byDim.PERFORMANCE_LEVEL.yearBreakdown, { '2023': 'A', '2024': 'B', '2025': 'B' });
  });

  it('3A → 6 分', () => {
    const drafts = buildBasicFactDrafts(
      mapping,
      [{ '工号': '002', '姓名': '李', '技能等级': '', '职称等级': '', '2023': 'A', '2024': 'A', '2025': 'A' }],
      2025,
      { skill: {}, title: {}, performance: { '3A': 6 } },
    );
    const perf = drafts.find((d) => d.dimension === 'PERFORMANCE_LEVEL')!;
    assert.equal(perf.score, 6);
    assert.equal(perf.tierValue, '3A');
  });

  it('工号缺失的行跳过', () => {
    const drafts = buildBasicFactDrafts(
      mapping,
      [{ '工号': '', '姓名': 'X', '技能等级': '', '职称等级': '', '2023': '', '2024': '', '2025': '' }],
      2025,
    );
    assert.equal(drafts.length, 0);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx tsx --test src/lib/basic-fact-import.test.ts`
Expected: FAIL — `Cannot find module './basic-fact-import'`。

- [ ] **Step 3: 实现 basic-fact-import.ts（草稿部分）**

Create `src/lib/basic-fact-import.ts`:

```typescript
/**
 * 基本素质三维度导入（技能/职称/绩效）。
 *
 * 一次上传 → 每行三条 EmployeeBasicFact。
 * 计分复用 basic-quality.ts 的 scoreSkillLevel/scoreTitleLevel/scorePerformanceLevel。
 */
import type { BasicDimension, PrismaClient } from '@prisma/client';
import {
  scoreSkillLevel,
  scoreTitleLevel,
  scorePerformanceLevel,
  DEFAULT_SKILL_TIERS,
  DEFAULT_TITLE_TIERS,
  DEFAULT_PERFORMANCE_TIERS,
} from './basic-quality';

export interface BasicFactFieldMapping {
  employeeNo: string;
  fullName: string;
  skill: string;
  title: string;
  perf2023: string;
  perf2024: string;
  perf2025: string;
}

/** 三维度档位表（来自 ScoringRule.config.tiers，缺则回退默认） */
export interface BasicFactTiers {
  skill?: Record<string, number>;
  title?: Record<string, number>;
  performance?: Record<string, number>;
}

export interface BasicFactDraft {
  employeeNo: string;
  employeeName: string;
  dimension: BasicDimension;
  tierValue: string;
  yearBreakdown: Record<string, string | null> | null;
  score: number;
}

const norm = (s: unknown): string => (s == null ? '' : String(s).trim());

/** 三年等级规范化为 'A'/'B'/null（C 与空 → null） */
function normGrade(v: unknown): string | null {
  const s = norm(v).toUpperCase();
  return s === 'A' || s === 'B' ? s : null;
}

/**
 * 由映射 + 行 → 三条事实草稿（技能/职称/绩效）。
 * 工号缺失跳过。绩效按三年 A/B 组合计分。
 */
export function buildBasicFactDrafts(
  mapping: BasicFactFieldMapping,
  rows: Record<string, string>[],
  evalYear: number,
  tiers: BasicFactTiers = {},
): BasicFactDraft[] {
  const skillTiers = tiers.skill ?? DEFAULT_SKILL_TIERS;
  const titleTiers = tiers.title ?? DEFAULT_TITLE_TIERS;
  const perfTiers = tiers.performance ?? DEFAULT_PERFORMANCE_TIERS;
  const drafts: BasicFactDraft[] = [];

  for (const row of rows) {
    const employeeNo = norm(row[mapping.employeeNo]);
    if (!employeeNo) continue;
    const employeeName = norm(row[mapping.fullName]);

    const skillLevel = norm(row[mapping.skill]);
    drafts.push({
      employeeNo, employeeName,
      dimension: 'SKILL_LEVEL',
      tierValue: skillLevel || '其他',
      yearBreakdown: null,
      score: scoreSkillLevel(skillLevel, skillTiers),
    });

    const titleLevel = norm(row[mapping.title]);
    drafts.push({
      employeeNo, employeeName,
      dimension: 'TITLE_LEVEL',
      tierValue: titleLevel || '无',
      yearBreakdown: null,
      score: scoreTitleLevel(titleLevel, titleTiers),
    });

    const g2023 = normGrade(row[mapping.perf2023]);
    const g2024 = normGrade(row[mapping.perf2024]);
    const g2025 = normGrade(row[mapping.perf2025]);
    const perf = scorePerformanceLevel([g2023, g2024, g2025], perfTiers);
    drafts.push({
      employeeNo, employeeName,
      dimension: 'PERFORMANCE_LEVEL',
      tierValue: perf.code,
      yearBreakdown: { '2023': g2023, '2024': g2024, '2025': g2025 },
      score: perf.score,
    });
  }

  // evalYear 用于 DB 写入的 year 字段；草稿阶段记录以备 importBasicFacts 使用
  void evalYear;
  return drafts;
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx tsx --test src/lib/basic-fact-import.test.ts`
Expected: PASS（3 tests）。

- [ ] **Step 5: 提交**

```bash
git add src/lib/basic-fact-import.ts src/lib/basic-fact-import.test.ts
git commit -m "feat(import): 基本素质三维度草稿 buildBasicFactDrafts"
```

---

## Task 7: 基本素质 DB 导入（importBasicFacts）

**Files:**
- Modify: `src/lib/basic-fact-import.ts`（追加 `loadBasicFactTiers` + `importBasicFacts`）

- [ ] **Step 1: 追加 DB 函数**

在 `src/lib/basic-fact-import.ts` 末尾追加：

```typescript
import { DEFAULT_SKILL_TIERS as _SK, DEFAULT_TITLE_TIERS as _TT, DEFAULT_PERFORMANCE_TIERS as _PT } from './basic-quality';
void _SK; void _TT; void _PT;

/** 从 DB 读三维度 tiers（无配置回退默认） */
export async function loadBasicFactTiers(prisma: PrismaClient): Promise<BasicFactTiers> {
  const read = async (code: string, fallback: Record<string, number>) => {
    const row = await prisma.scoringRule.findUnique({ where: { dimensionCode: code } });
    const cfg = (row?.config ?? {}) as { tiers?: Record<string, number> };
    return cfg.tiers ?? fallback;
  };
  const [skill, title, performance] = await Promise.all([
    read('basic.skill-level', DEFAULT_SKILL_TIERS),
    read('basic.title-level', DEFAULT_TITLE_TIERS),
    read('basic.performance-level', DEFAULT_PERFORMANCE_TIERS),
  ]);
  return { skill, title, performance };
}

export interface BasicFactImportResult {
  total: number;      // 员工行数
  created: number;
  updated: number;
}

/** 导入基本素质三维度：读 tiers → 草稿 → EmployeeBasicFact upsert */
export async function importBasicFacts(
  prisma: PrismaClient,
  mapping: BasicFactFieldMapping,
  rows: Record<string, string>[],
  evalYear: number,
  sourceFile: string,
): Promise<BasicFactImportResult> {
  const tiers = await loadBasicFactTiers(prisma);
  const drafts = buildBasicFactDrafts(mapping, rows, evalYear, tiers);

  // 统计涉及员工数
  const employeeNos = new Set(drafts.map((d) => d.employeeNo));

  let created = 0;
  let updated = 0;
  for (const f of drafts) {
    const user = await prisma.user.findFirst({
      where: { employeeNo: f.employeeNo },
      select: { id: true },
    });
    const result = await prisma.employeeBasicFact.upsert({
      where: {
        year_employeeNo_dimension: {
          year: evalYear, employeeNo: f.employeeNo, dimension: f.dimension,
        },
      },
      create: {
        year: evalYear, employeeNo: f.employeeNo, employeeName: f.employeeName,
        userId: user?.id ?? null, dimension: f.dimension,
        tierValue: f.tierValue,
        yearBreakdown: f.yearBreakdown ?? undefined,
        score: f.score, sourceFile,
      },
      update: {
        employeeName: f.employeeName, userId: user?.id ?? null,
        tierValue: f.tierValue,
        yearBreakdown: f.yearBreakdown ?? undefined,
        score: f.score, sourceFile,
      },
    });
    // upsert 无法直接区分 create/update，用 createdAt 与 updatedAt 比较
    if (result.createdAt.getTime() === result.updatedAt.getTime()) created++;
    else updated++;
  }

  return { total: employeeNos.size, created, updated };
}
```

- [ ] **Step 2: 确认测试通过**

Run: `npx tsx --test src/lib/basic-fact-import.test.ts`
Expected: PASS（纯函数测试不受影响）。

- [ ] **Step 3: 提交**

```bash
git add src/lib/basic-fact-import.ts
git commit -m "feat(import): importBasicFacts EmployeeBasicFact upsert"
```

---

## Task 8: 评分事实统一导入（manual-fact-import.ts）

两票/缺陷/安全三类都写 `PerformanceFact`，计分复用 `computeFactScores`。本任务做一个统一入口，按 dimensionCode 分发到不同的 FactInput 构造。

**Files:**
- Create: `src/lib/manual-fact-import.ts`
- Test: `src/lib/manual-fact-import.test.ts`

- [ ] **Step 1: 写失败测试（FactInput 构造纯函数）**

Create `src/lib/manual-fact-import.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rowsToFactInputs } from './manual-fact-import';

describe('rowsToFactInputs', () => {
  it('两票：映射 rawScore/declarationLevel', () => {
    const inputs = rowsToFactInputs(
      'worksite.ticket-execution',
      { employeeNo: '工号', employeeName: '姓名', rawScore: '原始分', declarationLevel: '能级', eventDate: '日期' },
      [{ '工号': '001', '姓名': '张', '原始分': '88', '能级': '一级', '日期': '2025-01-01' }],
    );
    assert.equal(inputs.length, 1);
    assert.equal(inputs[0].employeeNo, '001');
    assert.equal(inputs[0].rawScore, 88);
    assert.equal(inputs[0].declarationLevel, '一级');
    assert.equal(inputs[0].eventDate, '2025-01-01');
  });

  it('缺陷：映射 role/eventType/defectLevel/defectRef', () => {
    const inputs = rowsToFactInputs(
      'worksite.defect-governance',
      { employeeNo: '工号', employeeName: '姓名', role: '角色', eventType: '事件类型', defectLevel: '缺陷等级', defectRef: '缺陷编号', eventDate: '日期' },
      [{ '工号': '001', '姓名': '张', '角色': '第一发现人', '事件类型': '发现', '缺陷等级': '严重', '缺陷编号': 'D-1', '日期': '' }],
    );
    assert.equal(inputs[0].role, 'FIRST_DISCOVERER');
    assert.equal(inputs[0].eventType, 'DISCOVERY');
    assert.equal(inputs[0].defectLevel, '严重');
    assert.equal(inputs[0].defectRef, 'D-1');
  });

  it('安全：映射 role/faultCount/incidentId', () => {
    const inputs = rowsToFactInputs(
      'performance.safety-contribution',
      { employeeNo: '工号', employeeName: '姓名', role: '角色', faultCount: '故障次数', incidentId: '事件编号', eventDate: '日期' },
      [{ '工号': '001', '姓名': '张', '角色': '共同发现人', '故障次数': '3', '事件编号': 'INC-1', '日期': '' }],
    );
    assert.equal(inputs[0].role, 'CO_DISCOVERER');
    assert.equal(inputs[0].faultCount, 3);
    assert.equal(inputs[0].incidentId, 'INC-1');
  });

  it('工号缺失跳过', () => {
    const inputs = rowsToFactInputs(
      'worksite.ticket-execution',
      { employeeNo: '工号', employeeName: '姓名', rawScore: '分', declarationLevel: '能级', eventDate: '日期' },
      [{ '工号': '', '姓名': '', '分': '', '能级': '', '日期': '' }],
    );
    assert.equal(inputs.length, 0);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx tsx --test src/lib/manual-fact-import.test.ts`
Expected: FAIL — `Cannot find module './manual-fact-import'`。

- [ ] **Step 3: 实现 manual-fact-import.ts（纯函数部分）**

Create `src/lib/manual-fact-import.ts`:

```typescript
/**
 * 两票/缺陷/安全三类评分事实的统一导入。
 *
 * 计分复用 scoring-engine.ts 的 computeFactScores 与 DB ScoringRule，
 * 本模块只负责：行 → FactInput 构造 → 调引擎 → 写 PerformanceFact。
 */
import type { PrismaClient } from '@prisma/client';
import {
  computeFactScores,
  type FactInput,
  type FactRole,
  type FactEventType,
  type ScoringRule,
} from './scoring-engine';

/** 评分事实字段映射（联合类型，按维度用到不同子集） */
export interface FactFieldMapping {
  employeeNo: string;
  employeeName: string;
  role?: string;
  eventType?: string;
  defectLevel?: string;
  defectRef?: string;
  rawScore?: string;
  declarationLevel?: string;
  faultCount?: string;
  incidentId?: string;
  eventDate?: string;
}

const ROLE_MAP: Record<string, FactRole> = {
  '第一发现人': 'FIRST_DISCOVERER', FIRST_DISCOVERER: 'FIRST_DISCOVERER',
  '共同发现人': 'CO_DISCOVERER', CO_DISCOVERER: 'CO_DISCOVERER',
  '第一处理人': 'FIRST_HANDLER', FIRST_HANDLER: 'FIRST_HANDLER',
  '共同处理人': 'CO_HANDLER', CO_HANDLER: 'CO_HANDLER',
};

const EVENT_TYPE_MAP: Record<string, FactEventType> = {
  '发现': 'DISCOVERY', DISCOVERY: 'DISCOVERY',
  '处理': 'REMEDIATION', REMEDIATION: 'REMEDIATION', '消缺': 'REMEDIATION',
};

const norm = (s: unknown): string => (s == null ? '' : String(s).trim());

/** 行 → FactInput（按 dimensionCode 解读字段）。工号缺失跳过。 */
export function rowsToFactInputs(
  dimensionCode: string,
  mapping: FactFieldMapping,
  rows: Record<string, string>[],
  sourceFile = 'manual-upload',
): FactInput[] {
  const get = (row: Record<string, string>, key?: string): string | undefined => {
    if (!key) return undefined;
    const v = norm(row[key]);
    return v || undefined;
  };
  const inputs: FactInput[] = [];
  for (const row of rows) {
    const employeeNo = get(row, mapping.employeeNo);
    const employeeName = get(row, mapping.employeeName);
    if (!employeeNo) continue;

    inputs.push({
      employeeNo,
      employeeName: employeeName ?? '',
      dimensionCode,
      role: ROLE_MAP[get(row, mapping.role) ?? ''] ?? 'FIRST_DISCOVERER',
      eventType: EVENT_TYPE_MAP[get(row, mapping.eventType) ?? ''] ?? 'DISCOVERY',
      defectLevel: get(row, mapping.defectLevel) ?? '',
      defectRef: get(row, mapping.defectRef) ?? employeeNo,
      eventDate: get(row, mapping.eventDate),
      sourceFile,
      incidentId: get(row, mapping.incidentId),
      faultCount: get(row, mapping.faultCount) ? parseInt(get(row, mapping.faultCount)!, 10) || 1 : 1,
      rawScore: get(row, mapping.rawScore) ? parseFloat(get(row, mapping.rawScore)!) : undefined,
      declarationLevel: get(row, mapping.declarationLevel),
    });
  }
  return inputs;
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx tsx --test src/lib/manual-fact-import.test.ts`
Expected: PASS（4 tests）。

- [ ] **Step 5: 提交**

```bash
git add src/lib/manual-fact-import.ts src/lib/manual-fact-import.test.ts
git commit -m "feat(import): rowsToFactInputs 评分事实构造纯函数"
```

---

## Task 9: 评分事实 DB 导入（importScoreFacts）

**Files:**
- Modify: `src/lib/manual-fact-import.ts`（追加 `importScoreFacts`）

- [ ] **Step 1: 追加 importScoreFacts**

在 `src/lib/manual-fact-import.ts` 末尾追加：

```typescript
/** 从 DB 读维度 ScoringRule（无配置报错） */
async function loadScoringRule(
  prisma: PrismaClient,
  dimensionCode: string,
): Promise<ScoringRule> {
  const row = await prisma.scoringRule.findUnique({ where: { dimensionCode } });
  if (!row) throw new Error(`未找到维度「${dimensionCode}」的评分规则`);
  return {
    id: row.id,
    dimensionCode: row.dimensionCode,
    ruleType: row.ruleType as ScoringRule['ruleType'],
    cap: Number(row.cap),
    enabled: row.enabled,
    ...(row.config as Record<string, unknown>),
  };
}

export interface ScoreFactImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  unmatched: { name: string; reason: string }[];
}

/**
 * 导入评分事实：行 → FactInput → computeFactScores → PerformanceFact upsert。
 * @param dimensionCode worksite.ticket-execution | worksite.defect-governance | performance.safety-contribution
 */
export async function importScoreFacts(
  prisma: PrismaClient,
  dimensionCode: string,
  dimensionTitle: string,
  year: number,
  mapping: FactFieldMapping,
  rows: Record<string, string>[],
  sourceFile: string,
): Promise<ScoreFactImportResult> {
  const rule = await loadScoringRule(prisma, dimensionCode);
  if (!rule.enabled) throw new Error('该维度评分规则已禁用');

  const inputs = rowsToFactInputs(dimensionCode, mapping, rows, sourceFile);
  if (inputs.length === 0) throw new Error('没有可导入的有效数据行');

  const scored = computeFactScores(inputs, [rule]);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const f of scored) {
    const user = await prisma.user.findFirst({
      where: { employeeNo: f.employeeNo },
      select: { id: true },
    });

    const existing = await prisma.performanceFact.findFirst({
      where: {
        year, employeeNo: f.employeeNo, dimensionCode,
        defectRef: f.defectRef || f.employeeNo,
        role: f.role as never, eventType: f.eventType as never,
      },
    });

    const data = {
      year, employeeNo: f.employeeNo, employeeName: f.employeeName,
      userId: user?.id ?? null, dimensionCode, dimensionTitle,
      role: f.role as never, eventType: f.eventType as never,
      score: f.score, defectRef: f.defectRef || f.employeeNo,
      defectLevel: f.defectLevel ?? '', eventDate: f.eventDate ?? null,
      sourceFile, metadata: (f.metadata ?? {}) as object,
    };

    if (existing) {
      await prisma.performanceFact.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await prisma.performanceFact.create({ data });
      created++;
    }
  }

  return { total: scored.length, created, updated, skipped, unmatched: [] };
}
```

- [ ] **Step 2: 确认测试通过**

Run: `npx tsx --test src/lib/manual-fact-import.test.ts`
Expected: PASS。

- [ ] **Step 3: 提交**

```bash
git add src/lib/manual-fact-import.ts
git commit -m "feat(import): importScoreFacts PerformanceFact 统一导入"
```

---

## Task 10: 试算分发（import-preview.ts）

预览端点的纯函数核心：按 itemCode 调对应计分函数，返回每行试算分数。员工档案类返回状态而非分数。

**Files:**
- Create: `src/lib/import-preview.ts`
- Test: `src/lib/import-preview.test.ts`

- [ ] **Step 1: 写失败测试**

Create `src/lib/import-preview.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { previewBasicFacts } from './import-preview';

describe('previewBasicFacts', () => {
  it('返回每行三维度试算分', () => {
    const rows = previewBasicFacts(
      { employeeNo: '工号', fullName: '姓名', skill: '技能等级', title: '职称等级', perf2023: '2023', perf2024: '2024', perf2025: '2025' },
      [{ '工号': '001', '姓名': '张', '技能等级': '技师', '职称等级': '中级', '2023': 'A', '2024': 'A', '2025': 'A' }],
      { skill: { 技师: 3 }, title: { 中级: 3 }, performance: { '3A': 6 } },
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].employeeNo, '001');
    assert.equal(rows[0].skillScore, 3);
    assert.equal(rows[0].titleScore, 3);
    assert.equal(rows[0].performanceScore, 6);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx tsx --test src/lib/import-preview.test.ts`
Expected: FAIL — `Cannot find module './import-preview'`。

- [ ] **Step 3: 实现 import-preview.ts**

Create `src/lib/import-preview.ts`:

```typescript
/**
 * 导入预览试算：按 itemCode 分发到对应计分函数。
 *
 * 评分事实类（tickets/defects/safety）的完整试算需 ScoringRule，
 * 由 preview 路由从 DB 加载后调用 previewScoreFacts；
 * 基本素质类用纯档位表 previewBasicFacts；
 * 员工档案类无分数，由路由层返回「将新建/将更新」状态。
 */
import { buildBasicFactDrafts, type BasicFactFieldMapping, type BasicFactTiers } from './basic-fact-import';

export interface BasicPreviewRow {
  employeeNo: string;
  employeeName: string;
  skillScore: number;
  titleScore: number;
  performanceScore: number;
}

/** 基本素质试算：每行三维度得分 */
export function previewBasicFacts(
  mapping: BasicFactFieldMapping,
  rows: Record<string, string>[],
  tiers: BasicFactTiers,
): BasicPreviewRow[] {
  const drafts = buildBasicFactDrafts(mapping, rows, 0, tiers);
  const grouped = new Map<string, BasicPreviewRow>();
  for (const d of drafts) {
    let r = grouped.get(d.employeeNo);
    if (!r) {
      r = { employeeNo: d.employeeNo, employeeName: d.employeeName, skillScore: 0, titleScore: 0, performanceScore: 0 };
      grouped.set(d.employeeNo, r);
    }
    if (d.dimension === 'SKILL_LEVEL') r.skillScore = d.score;
    else if (d.dimension === 'TITLE_LEVEL') r.titleScore = d.score;
    else if (d.dimension === 'PERFORMANCE_LEVEL') r.performanceScore = d.score;
  }
  return [...grouped.values()];
}
```

> 说明：评分事实类（tickets/defects/safety）的试算需要 DB `ScoringRule`，无法做无 DB 纯单测。其分发逻辑放在路由层 `preview/route.ts`（Task 16），直接调 `computeFactScores`。

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx tsx --test src/lib/import-preview.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/lib/import-preview.ts src/lib/import-preview.test.ts
git commit -m "feat(import): previewBasicFacts 基本素质试算"
```

---

## Task 11: 员工档案导入 API

**Files:**
- Create: `src/app/api/admin/import/employees/route.ts`

- [ ] **Step 1: 实现路由**

Create `src/app/api/admin/import/employees/route.ts`:

```typescript
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { importEmployees, type EmployeeFieldMapping } from '@/lib/employee-import';

const MappingSchema = z.object({
  employeeNo: z.string(),
  fullName: z.string(),
  workArea: z.string(),
  department: z.string().optional().default(''),
  team: z.string().optional().default(''),
  position: z.string().optional().default(''),
  gender: z.string().optional().default(''),
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

    const { year, sourceFile, mapping, rows } = parsed.data;
    void year; // 员工档案不按年度区分，保留参数供未来扩展

    const result = await importEmployees(prisma, mapping as EmployeeFieldMapping, rows, sourceFile);

    return NextResponse.json({
      success: true,
      total: result.total,
      created: result.usersCreated,
      updated: result.usersUpdated,
      skipped: 0,
    });
  } catch (e) {
    console.error('POST /api/admin/import/employees:', e);
    const message = e instanceof Error ? e.message : '服务器内部错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: 类型/编译检查**

Run: `npx tsc --noEmit 2>&1 | grep -E "import/employees|employee-import|team-org" || echo "no errors in target files"`
Expected: 目标文件无类型错误（或输出 "no errors in target files"）。若 `tsc` 不可用，跳过。

- [ ] **Step 3: 提交**

```bash
git add src/app/api/admin/import/employees/route.ts
git commit -m "feat(api): POST /api/admin/import/employees 员工档案导入"
```

---

## Task 12: 基本素质导入 API

**Files:**
- Create: `src/app/api/admin/import/basic/route.ts`

- [ ] **Step 1: 实现路由**

Create `src/app/api/admin/import/basic/route.ts`:

```typescript
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { importBasicFacts, type BasicFactFieldMapping } from '@/lib/basic-fact-import';

const MappingSchema = z.object({
  employeeNo: z.string(),
  fullName: z.string().optional().default(''),
  skill: z.string().optional().default(''),
  title: z.string().optional().default(''),
  perf2023: z.string().optional().default(''),
  perf2024: z.string().optional().default(''),
  perf2025: z.string().optional().default(''),
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

    const { year, sourceFile, mapping, rows } = parsed.data;
    const result = await importBasicFacts(prisma, mapping as BasicFactFieldMapping, rows, year, sourceFile);

    return NextResponse.json({
      success: true,
      total: result.total,
      created: result.created,
      updated: result.updated,
      skipped: 0,
    });
  } catch (e) {
    console.error('POST /api/admin/import/basic:', e);
    const message = e instanceof Error ? e.message : '服务器内部错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/app/api/admin/import/basic/route.ts
git commit -m "feat(api): POST /api/admin/import/basic 基本素质三维度导入"
```

---

## Task 13: 两票/缺陷/安全导入 API（三个路由）

三个路由结构相同，仅 dimensionCode/dimensionTitle 不同。

**Files:**
- Create: `src/app/api/admin/import/tickets/route.ts`
- Create: `src/app/api/admin/import/defects/route.ts`
- Create: `src/app/api/admin/import/safety/route.ts`

- [ ] **Step 1: 实现 tickets 路由**

Create `src/app/api/admin/import/tickets/route.ts`:

```typescript
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { importScoreFacts, type FactFieldMapping } from '@/lib/manual-fact-import';

const MappingSchema = z.object({
  employeeNo: z.string(),
  employeeName: z.string().optional().default(''),
  rawScore: z.string().optional().default(''),
  declarationLevel: z.string().optional().default(''),
  eventDate: z.string().optional().default(''),
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

    const { year, sourceFile, mapping, rows } = parsed.data;
    const result = await importScoreFacts(
      prisma, 'worksite.ticket-execution', '两票执行',
      year, mapping as FactFieldMapping, rows, sourceFile,
    );

    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    console.error('POST /api/admin/import/tickets:', e);
    const message = e instanceof Error ? e.message : '服务器内部错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: 实现 defects 路由**

Create `src/app/api/admin/import/defects/route.ts`:

```typescript
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { importScoreFacts, type FactFieldMapping } from '@/lib/manual-fact-import';

const MappingSchema = z.object({
  employeeNo: z.string(),
  employeeName: z.string().optional().default(''),
  role: z.string().optional().default(''),
  eventType: z.string().optional().default(''),
  defectLevel: z.string().optional().default(''),
  defectRef: z.string().optional().default(''),
  eventDate: z.string().optional().default(''),
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

    const { year, sourceFile, mapping, rows } = parsed.data;
    const result = await importScoreFacts(
      prisma, 'worksite.defect-governance', '缺陷治理',
      year, mapping as FactFieldMapping, rows, sourceFile,
    );

    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    console.error('POST /api/admin/import/defects:', e);
    const message = e instanceof Error ? e.message : '服务器内部错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 3: 实现 safety 路由**

Create `src/app/api/admin/import/safety/route.ts`:

```typescript
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { importScoreFacts, type FactFieldMapping } from '@/lib/manual-fact-import';

const MappingSchema = z.object({
  employeeNo: z.string(),
  employeeName: z.string().optional().default(''),
  role: z.string().optional().default(''),
  faultCount: z.string().optional().default(''),
  incidentId: z.string().optional().default(''),
  eventDate: z.string().optional().default(''),
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

    const { year, sourceFile, mapping, rows } = parsed.data;
    const result = await importScoreFacts(
      prisma, 'performance.safety-contribution', '安全贡献',
      year, mapping as FactFieldMapping, rows, sourceFile,
    );

    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    console.error('POST /api/admin/import/safety:', e);
    const message = e instanceof Error ? e.message : '服务器内部错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 4: 提交**

```bash
git add src/app/api/admin/import/tickets/route.ts src/app/api/admin/import/defects/route.ts src/app/api/admin/import/safety/route.ts
git commit -m "feat(api): 两票/缺陷/安全 导入路由(复用 importScoreFacts)"
```

---

## Task 14: 试算 API（preview）

**Files:**
- Create: `src/app/api/admin/import/preview/route.ts`

- [ ] **Step 1: 实现路由**

Create `src/app/api/admin/import/preview/route.ts`:

```typescript
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { previewBasicFacts } from '@/lib/import-preview';
import { loadBasicFactTiers, type BasicFactFieldMapping } from '@/lib/basic-fact-import';
import { rowsToFactInputs } from '@/lib/manual-fact-import';
import { computeFactScores, type ScoringRule } from '@/lib/scoring-engine';

const BodySchema = z.object({
  itemCode: z.enum(['employees', 'basic', 'tickets', 'defects', 'safety']),
  mapping: z.record(z.string(), z.string()),
  rows: z.array(z.record(z.string(), z.string())).min(1),
});

async function loadRule(dimensionCode: string): Promise<ScoringRule> {
  const row = await prisma.scoringRule.findUnique({ where: { dimensionCode } });
  if (!row) throw new Error(`未找到维度「${dimensionCode}」的评分规则`);
  return {
    id: row.id, dimensionCode: row.dimensionCode,
    ruleType: row.ruleType as ScoringRule['ruleType'],
    cap: Number(row.cap), enabled: row.enabled,
    ...(row.config as Record<string, unknown>),
  };
}

export async function POST(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: '参数无效', issues: parsed.error.issues }, { status: 400 });
    }

    const { itemCode, mapping, rows } = parsed.data;

    if (itemCode === 'employees') {
      // 员工档案无分数，返回行数与字段预览
      return NextResponse.json({
        success: true,
        kind: 'status',
        rows: rows.slice(0, 20).map((r) => ({
          employeeNo: r[mapping.employeeNo] ?? '',
          fullName: r[mapping.fullName] ?? '',
          status: '将新建/更新',
        })),
      });
    }

    if (itemCode === 'basic') {
      const tiers = await loadBasicFactTiers(prisma);
      const preview = previewBasicFacts(mapping as BasicFactFieldMapping, rows.slice(0, 20), tiers);
      return NextResponse.json({ success: true, kind: 'score', rows: preview });
    }

    // tickets / defects / safety
    const dimMap = {
      tickets: 'worksite.ticket-execution',
      defects: 'worksite.defect-governance',
      safety: 'performance.safety-contribution',
    } as const;
    const dimensionCode = dimMap[itemCode as 'tickets' | 'defects' | 'safety'];
    const rule = await loadRule(dimensionCode);
    const inputs = rowsToFactInputs(dimensionCode, mapping, rows.slice(0, 20));
    const scored = computeFactScores(inputs, [rule]);
    return NextResponse.json({
      success: true,
      kind: 'score',
      rows: scored.map((s) => ({ employeeNo: s.employeeNo, score: s.score })),
    });
  } catch (e) {
    console.error('POST /api/admin/import/preview:', e);
    const message = e instanceof Error ? e.message : '服务器内部错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/app/api/admin/import/preview/route.ts
git commit -m "feat(api): POST /api/admin/import/preview 试算分发"
```

---

## Task 15: 前端共享 — types / parse / field-specs

**Files:**
- Create: `src/app/admin/import/_shared/types.ts`
- Create: `src/app/admin/import/_shared/parse.ts`
- Create: `src/app/admin/import/_shared/field-specs.ts`

- [ ] **Step 1: types.ts**

Create `src/app/admin/import/_shared/types.ts`:

```typescript
export type ItemCode = 'employees' | 'basic' | 'tickets' | 'defects' | 'safety';

export interface FieldSpec {
  key: string;
  label: string;
  required: boolean;
  hint?: string;
}

export interface ImportItemConfig {
  code: ItemCode;
  title: string;
  description: string;
  dependsOn: string;
  fields: FieldSpec[];
  apiEndpoint: string;
  requireFullBatch?: boolean;
  hasScorePreview: boolean;
}
```

- [ ] **Step 2: parse.ts（从 legacy/page.tsx 抽出）**

Create `src/app/admin/import/_shared/parse.ts`:

```typescript
import * as XLSX from 'xlsx';

export interface ParsedFile {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCSV(text: string): ParsedFile {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',').map((v) => v.trim());
    if (vals.length === 0 || (vals.length === 1 && !vals[0])) continue;
    while (vals.length < headers.length) vals.push('');
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) row[headers[j]] = vals[j] || '';
    rows.push(row);
  }
  return { headers, rows };
}

export function parseXLSX(buffer: ArrayBuffer): ParsedFile {
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { headers: [], rows: [] };
  const sheet = wb.Sheets[sheetName];
  const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  if (raw.length === 0) return { headers: [], rows: [] };
  const headerSet = new Set<string>();
  for (const obj of raw) {
    for (const k of Object.keys(obj)) {
      if (k && typeof k === 'string' && k.trim()) headerSet.add(k.trim());
    }
  }
  const headers = Array.from(headerSet);
  const rows = raw.map((obj) => {
    const row: Record<string, string> = {};
    for (const h of headers) {
      const val = obj[h];
      row[h] = val != null ? String(val).trim() : '';
    }
    return row;
  });
  return { headers, rows };
}
```

- [ ] **Step 3: field-specs.ts（5 项配置）**

Create `src/app/admin/import/_shared/field-specs.ts`:

```typescript
import type { ImportItemConfig } from './types';

export const IMPORT_ITEMS: ImportItemConfig[] = [
  {
    code: 'employees',
    title: '员工档案与组织架构',
    description: '导入员工档案，自动创建 工区/部门/班组 三层组织（缺则建）。',
    dependsOn: '无（最先导入，建立名册）',
    apiEndpoint: '/api/admin/import/employees',
    hasScorePreview: false,
    fields: [
      { key: 'employeeNo', label: '工号', required: true },
      { key: 'fullName', label: '姓名', required: true },
      { key: 'workArea', label: '工区', required: true, hint: '含总部及各工区' },
      { key: 'department', label: '部门', required: true },
      { key: 'team', label: '班组', required: false },
      { key: 'position', label: '岗位', required: false },
      { key: 'gender', label: '性别', required: false },
    ],
  },
  {
    code: 'basic',
    title: '基本素质三维度',
    description: '一次上传算出技能/职称/绩效三条事实，绩效按三年 A/B 组合计分。',
    dependsOn: '依赖员工档案名册',
    apiEndpoint: '/api/admin/import/basic',
    hasScorePreview: true,
    fields: [
      { key: 'employeeNo', label: '工号', required: true },
      { key: 'fullName', label: '姓名', required: false },
      { key: 'skill', label: '技能等级', required: false },
      { key: 'title', label: '职称等级', required: false },
      { key: 'perf2023', label: '绩效2023', required: false },
      { key: 'perf2024', label: '绩效2024', required: false },
      { key: 'perf2025', label: '绩效2025', required: false },
    ],
  },
  {
    code: 'tickets',
    title: '两票执行',
    description: 'NORMALIZE 折算：原始分 ÷ 能级内最高 × 30。',
    dependsOn: '依赖员工档案名册',
    apiEndpoint: '/api/admin/import/tickets',
    requireFullBatch: true,
    hasScorePreview: true,
    fields: [
      { key: 'employeeNo', label: '工号', required: true },
      { key: 'employeeName', label: '姓名', required: false },
      { key: 'rawScore', label: '原始分', required: true, hint: '请上传全部人员数据，分批会导致折算错误' },
      { key: 'declarationLevel', label: '能级', required: true },
      { key: 'eventDate', label: '事件日期', required: false },
    ],
  },
  {
    code: 'defects',
    title: '缺陷治理',
    description: 'MATRIX_SUM：角色×缺陷等级计分，封顶12，含多人拆分与合作标记。',
    dependsOn: '依赖员工档案名册',
    apiEndpoint: '/api/admin/import/defects',
    hasScorePreview: true,
    fields: [
      { key: 'employeeNo', label: '工号', required: true },
      { key: 'employeeName', label: '姓名', required: false },
      { key: 'role', label: '角色', required: false, hint: '第一发现人/共同发现人/第一处理人/共同处理人' },
      { key: 'eventType', label: '事件类型', required: false, hint: '发现/处理' },
      { key: 'defectLevel', label: '缺陷等级', required: false, hint: '危急/严重/一般' },
      { key: 'defectRef', label: '缺陷编号', required: false },
      { key: 'eventDate', label: '事件日期', required: false },
    ],
  },
  {
    code: 'safety',
    title: '安全贡献',
    description: 'SHARE 均分：按事件分组，第一发现人3分/次，其他发现人均分。',
    dependsOn: '依赖员工档案名册',
    apiEndpoint: '/api/admin/import/safety',
    hasScorePreview: true,
    fields: [
      { key: 'employeeNo', label: '工号', required: true },
      { key: 'employeeName', label: '姓名', required: false },
      { key: 'role', label: '角色', required: false, hint: '第一发现人/共同发现人' },
      { key: 'faultCount', label: '故障次数', required: false },
      { key: 'incidentId', label: '事件编号', required: false },
      { key: 'eventDate', label: '事件日期', required: false },
    ],
  },
];

export function getItemConfig(code: string): ImportItemConfig {
  return IMPORT_ITEMS.find((i) => i.code === code) ?? IMPORT_ITEMS[0];
}
```

- [ ] **Step 4: 提交**

```bash
git add src/app/admin/import/_shared/types.ts src/app/admin/import/_shared/parse.ts src/app/admin/import/_shared/field-specs.ts
git commit -m "feat(ui): 导入共享 types/parse/field-specs(5项配置)"
```

---

## Task 16: ImportWizard 四步表单组件

**Files:**
- Create: `src/app/admin/import/_shared/ImportWizard.tsx`

- [ ] **Step 1: 实现组件**

Create `src/app/admin/import/_shared/ImportWizard.tsx`:

```tsx
'use client';
import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import type { ImportItemConfig } from './types';
import { parseCSV, parseXLSX, type ParsedFile } from './parse';

interface PreviewRow { employeeNo: string; [k: string]: unknown }

export default function ImportWizard({ config, year }: { config: ImportItemConfig; year: number }) {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ total: number; created: number; updated: number; skipped: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 切换配置或表头变化时，按中文 label 自动模糊匹配
  useEffect(() => {
    if (headers.length === 0) return;
    const auto: Record<string, string> = {};
    for (const f of config.fields) {
      const m = headers.find((h) => h === f.label || h.includes(f.label));
      if (m) auto[f.key] = m;
    }
    setMapping(auto);
  }, [config, headers]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    const reader = new FileReader();
    const process = (parsed: ParsedFile) => {
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      setResult(null);
      setPreview(null);
      const auto: Record<string, string> = {};
      for (const f of config.fields) {
        const m = parsed.headers.find((h) => h === f.label || h.includes(f.label));
        if (m) auto[f.key] = m;
      }
      setMapping(auto);
    };
    if (ext === 'xlsx' || ext === 'xls') {
      reader.onload = () => process(parseXLSX(reader.result as ArrayBuffer));
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = () => process(parseCSV(reader.result as string));
      reader.readAsText(file);
    }
  };

  const requiredOk = config.fields.filter((f) => f.required).every((f) => mapping[f.key]);

  const runPreview = async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/admin/import/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemCode: config.code, mapping, rows: rows.slice(0, 20) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { alert('试算失败：' + (d.error || r.status)); setPreview(null); }
      else setPreview(d.rows ?? []);
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    if (rows.length === 0) { alert('请先选择文件'); return; }
    setBusy(true);
    try {
      const r = await fetch(config.apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year, sourceFile: fileRef.current?.files?.[0]?.name ?? 'upload.csv',
          mapping, rows,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { alert('导入失败：' + (d.error || r.status)); return; }
      setResult(d);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setHeaders([]); setRows([]); setResult(null); setPreview(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <Link href="/admin/import" className="text-sm font-medium text-slate-500 hover:text-slate-700 cursor-pointer">← 返回导入中心</Link>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">{config.title}</h1>
      <p className="mt-1 text-sm text-slate-500">{config.description}</p>
      <p className="mt-1 text-xs text-slate-400">{config.dependsOn}</p>

      {/* 步骤1：上传 */}
      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold">① 上传文件（CSV / Excel）</h2>
        <div className="mt-3 flex gap-3">
          <input type="file" accept=".csv,.xlsx,.xls" ref={fileRef} onChange={handleFile}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:text-white transition-colors" />
          {rows.length > 0 && (
            <button onClick={reset} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 cursor-pointer">清空</button>
          )}
        </div>
        {rows.length > 0 && <p className="mt-2 text-xs text-slate-500">已解析 {rows.length} 行</p>}
        {config.requireFullBatch && (
          <p className="mt-2 text-xs text-amber-700">⚠️ 请上传全部人员数据，分批会导致折算错误。</p>
        )}
      </section>

      {/* 步骤2：映射 */}
      {headers.length > 0 && (
        <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold">② 字段映射</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {config.fields.map((f) => (
              <label key={f.key} className="flex items-center gap-2 text-xs">
                <span className="w-20 shrink-0 font-medium text-slate-600">
                  {f.label}{f.required && <span className="text-red-500"> *</span>}
                </span>
                <select value={mapping[f.key] ?? ''} onChange={(e) => setMapping((p) => ({ ...p, [f.key]: e.target.value }))}
                  className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs">
                  <option value="">—</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
          {config.fields.filter((f) => f.required && f.hint).map((f) => (
            <p key={f.key} className="mt-2 text-xs text-slate-400">{f.label}：{f.hint}</p>
          ))}
        </section>
      )}

      {/* 步骤3：预览 + 试算 */}
      {rows.length > 0 && config.hasScorePreview && (
        <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold">③ 预览（含分数试算）</h2>
          <button onClick={runPreview} disabled={busy || !requiredOk}
            className="mt-3 rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50 cursor-pointer">
            {busy ? '试算中…' : '试算（前20行）'}
          </button>
          {preview && (
            <div className="mt-3 max-h-[300px] overflow-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b text-left text-slate-500">
                  {Object.keys(preview[0] ?? {}).map((k) => <th key={k} className="pb-2 pr-3 font-medium whitespace-nowrap">{k}</th>)}
                </tr></thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i} className="border-b border-slate-50">
                      {Object.keys(preview[0] ?? {}).map((k) => <td key={k} className="py-1 pr-3 whitespace-nowrap">{String(r[k] ?? '—')}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* 步骤4：导入 */}
      {rows.length > 0 && (
        <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold">④ 导入</h2>
          <button onClick={doImport} disabled={busy || !requiredOk}
            className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer">
            {busy ? '导入中…' : `导入 ${rows.length} 条`}
          </button>
          {!requiredOk && <p className="mt-2 text-xs text-red-500">请先完成必填字段映射（*）。</p>}
          {result && (
            <p className="mt-3 text-sm text-emerald-700">
              共 {result.total} 条 · 新建 {result.created} · 更新 {result.updated} · 跳过 {result.skipped}
            </p>
          )}
        </section>
      )}
    </main>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add src/app/admin/import/_shared/ImportWizard.tsx
git commit -m "feat(ui): ImportWizard 四步表单组件(上传/映射/预览试算/导入)"
```

---

## Task 17: 5 个导入子页

**Files:**
- Create: `src/app/admin/import/employees/page.tsx`
- Create: `src/app/admin/import/basic/page.tsx`
- Create: `src/app/admin/import/tickets/page.tsx`
- Create: `src/app/admin/import/defects/page.tsx`
- Create: `src/app/admin/import/safety/page.tsx`

- [ ] **Step 1: employees 子页**

Create `src/app/admin/import/employees/page.tsx`:

```tsx
'use client';
import { useState } from 'react';
import ImportWizard from '../_shared/ImportWizard';
import { getItemConfig } from '../_shared/field-specs';

export default function EmployeesImportPage() {
  const [year] = useState(new Date().getFullYear());
  return <ImportWizard config={getItemConfig('employees')} year={year} />;
}
```

- [ ] **Step 2: basic 子页**

Create `src/app/admin/import/basic/page.tsx`:

```tsx
'use client';
import { useState } from 'react';
import ImportWizard from '../_shared/ImportWizard';
import { getItemConfig } from '../_shared/field-specs';

export default function BasicImportPage() {
  const [year] = useState(new Date().getFullYear());
  return <ImportWizard config={getItemConfig('basic')} year={year} />;
}
```

- [ ] **Step 3: tickets 子页**

Create `src/app/admin/import/tickets/page.tsx`:

```tsx
'use client';
import { useState } from 'react';
import ImportWizard from '../_shared/ImportWizard';
import { getItemConfig } from '../_shared/field-specs';

export default function TicketsImportPage() {
  const [year] = useState(new Date().getFullYear());
  return <ImportWizard config={getItemConfig('tickets')} year={year} />;
}
```

- [ ] **Step 4: defects 子页**

Create `src/app/admin/import/defects/page.tsx`:

```tsx
'use client';
import { useState } from 'react';
import ImportWizard from '../_shared/ImportWizard';
import { getItemConfig } from '../_shared/field-specs';

export default function DefectsImportPage() {
  const [year] = useState(new Date().getFullYear());
  return <ImportWizard config={getItemConfig('defects')} year={year} />;
}
```

- [ ] **Step 5: safety 子页**

Create `src/app/admin/import/safety/page.tsx`:

```tsx
'use client';
import { useState } from 'react';
import ImportWizard from '../_shared/ImportWizard';
import { getItemConfig } from '../_shared/field-specs';

export default function SafetyImportPage() {
  const [year] = useState(new Date().getFullYear());
  return <ImportWizard config={getItemConfig('safety')} year={year} />;
}
```

- [ ] **Step 6: 提交**

```bash
git add src/app/admin/import/employees/page.tsx src/app/admin/import/basic/page.tsx src/app/admin/import/tickets/page.tsx src/app/admin/import/defects/page.tsx src/app/admin/import/safety/page.tsx
git commit -m "feat(ui): 5 个导入子页(极薄,共用 ImportWizard)"
```

---

## Task 18: 首页改造为卡片墙

**Files:**
- Modify: `src/app/admin/import/page.tsx`（整体替换）

- [ ] **Step 1: 替换首页为卡片墙**

将 `src/app/admin/import/page.tsx` 整体替换为：

```tsx
'use client';
import Link from 'next/link';
import { IMPORT_ITEMS } from './_shared/field-specs';

export default function ImportCenterPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <Link href="/admin" className="text-sm font-medium text-slate-500 hover:text-slate-700">← 返回管理后台</Link>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">数据导入中心</h1>
      <p className="mt-1 text-sm text-slate-500">
        选择导入项，上传文件并映射字段。建议按 ①→⑤ 顺序导入：员工档案最先，其余评分项依赖名册。
      </p>

      <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {IMPORT_ITEMS.map((item, idx) => (
          <Link
            key={item.code}
            href={`/admin/import/${item.code}`}
            className="block rounded-xl border border-slate-200 bg-white p-5 transition-colors hover:border-slate-400 hover:shadow-sm cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                {['①', '②', '③', '④', '⑤'][idx]}
              </span>
              <h2 className="text-sm font-semibold">{item.title}</h2>
            </div>
            <p className="mt-2 text-xs text-slate-500">{item.description}</p>
            <p className="mt-2 text-[11px] text-slate-400">{item.dependsOn}</p>
          </Link>
        ))}
      </section>

      <section className="mt-6 rounded-xl border border-slate-100 bg-slate-50 p-4">
        <h2 className="text-xs font-semibold text-slate-600">查看导入结果</h2>
        <p className="mt-1 text-xs text-slate-400">
          导入完成后，可在原
          <Link href="/admin" className="ml-1 text-primary-600 underline">管理后台</Link>
          查看绩效分表与未匹配记录（查询 API 未变更）。
        </p>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add src/app/admin/import/page.tsx
git commit -m "feat(ui): /admin/import 首页改造为导入中心卡片墙"
```

---

## Task 19: 下线 legacy 页与旧单维度路由

**Files:**
- Delete: `src/app/admin/import/legacy/page.tsx`
- Delete: `src/app/api/admin/import/route.ts`

- [ ] **Step 1: 检查无残留引用**

Run:
```bash
grep -rn "admin/import/legacy\|api/admin/import'" src/ 2>/dev/null | grep -v node_modules || echo "no stray refs"
```
Expected: 无指向已删除路由/页的活跃引用（首页已重写，legacy 链接已移除）。注意 `/api/admin/import/overview`、`/api/admin/import/pipeline`、`/api/admin/import/scores`、`/api/admin/import/preview`、`/api/admin/import/{employees,basic,tickets,defects,safety}` 是保留/新增的，不算残留。

- [ ] **Step 2: 删除 legacy 页**

```bash
git rm src/app/admin/import/legacy/page.tsx
rmdir src/app/admin/import/legacy 2>/dev/null || true
```

- [ ] **Step 3: 删除旧单维度路由**

```bash
git rm src/app/api/admin/import/route.ts
```

- [ ] **Step 4: 提交**

```bash
git commit -m "chore(import): 下线 legacy 单维度导入页与路由(已被卡片导入取代)"
```

---

## Task 20: 全量验收

- [ ] **Step 1: 运行全部单测**

Run: `npm test`
Expected: 全绿，含新增 team-org / employee-import / basic-fact-import / manual-fact-import / import-preview 测试。

- [ ] **Step 2: 构建（类型 + 编译）**

Run: `npm run build`
Expected: 构建成功，无类型错误。若 `xlsx` 在客户端 bundle 警告可忽略（与现状一致）。

- [ ] **Step 3: 启动开发服务器，人工走查导入中心**

Run: `npm run dev`，浏览器打开 `http://localhost:3000/admin/import`：
- 首页显示 5 张卡片（①–⑤），点各卡片进入对应子页。
- 卡片①（员工档案）：上传含 工号/姓名/工区/部门/班组 列的 Excel → 自动映射 → 导入 → 检查 DB（`prisma studio`）User 与三层 Branch/Department/Team 已建。
- 卡片②（基本素质）：上传含三年绩效列 → 试算显示三维度分 → 导入 → 检查 `EmployeeBasicFact` 三条。
- 卡片③④⑤：分别上传 → 试算 → 导入 → 检查 `PerformanceFact` 对应 dimensionCode 有记录。
- 必填字段未映射时导入按钮禁用并提示。

- [ ] **Step 4: 验证旧入口已下线**

浏览器访问 `http://localhost:3000/admin/import/legacy` 应 404；`POST /api/admin/import`（旧单维度）应 404。

- [ ] **Step 5: 最终提交（如有验收修复）**

```bash
git add -A
git commit -m "test(import): 全量验收通过" || echo "无改动无需提交"
```

---

## Self-Review 自检结果

**1. Spec 覆盖：**
- 三层组织（Team 表）：Task 1 ✅
- 卡片①员工档案：Task 2-5（库）+ Task 11（API）✅
- 卡片②基本素质：Task 6-7（库）+ Task 12（API）✅
- 卡片③④⑤：Task 8-9（库）+ Task 13（API）✅
- 试算端点：Task 10（库）+ Task 14（API）✅
- 四步 ImportWizard：Task 16 ✅
- 5 子页 + 卡片墙首页：Task 17-18 ✅
- 下线 legacy/旧路由：Task 19 ✅
- 测试：各库 Task 含纯函数单测；preview 分发测试在 Task 10（basic）+ Task 20 集成 ✅
- pipeline UI 下线但库保留：Task 18 重写首页（移除一键按钮）✅，`runImportPipeline` 未删 ✅

**2. 占位符扫描：** 无 TBD/TODO；代码块完整。

**3. 类型一致性：** `EmployeeFieldMapping`（Task4/5/11）、`BasicFactFieldMapping`（Task6/7/12/14）、`FactFieldMapping`（Task8/9/13）、`ImportItemConfig`（Task15/16/17/18）跨任务命名一致。field-specs.ts 的 field key 与各 Mapping schema key 对齐（employeeNo/fullName/workArea/department/team/position/gender；skill/title/perf2023-2025；rawScore/declarationLevel；role/eventType/defectLevel/defectRef；faultCount/incidentId）✅
