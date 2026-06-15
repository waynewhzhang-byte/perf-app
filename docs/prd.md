# 企业员工绩效申报系统 — 产品需求文档 (PRD)

> **产品类型**: 企业内部管理系统（Web 应用）
> **目标用户**: 国网山西超高压变电公司 — 全体员工、审核员、管理员
> **部署方式**: 本地化部署（Docker + PostgreSQL + MinIO）
> **文档版本**: 1.0
> **生成日期**: 2026-06-16

---

## 一、产品概述

### 1.1 产品定位

企业员工绩效申报系统是一套面向电力行业央企的**年度能级评价与绩效量化管理平台**。系统基于《国网山西超高压变电公司能级评价量化积分表（暂行稿）》设计，将传统纸质申报和 Excel 打分流程全面数字化，实现从数据导入、员工申报、多级审核到绩效归档的全链路在线化。

### 1.2 核心价值

| 痛点 | 解决方案 |
|------|----------|
| 纸质申报效率低、易丢失 | 在线表单填报 + 草稿保存 + MinIO 附件存储 |
| Excel 手工计分易错 | 三种可配置评分规则引擎（MATRIX/SHARE/NORMALIZE）自动计算 |
| 跨部门审核流转慢 | 两级在线审核（分公司 L1 → 总公司 L2），逐项通过/驳回 |
| 缺陷数据人工归集耗时 | 从运检部 Excel 缺陷库自动导入 → 按角色计分 → 写入绩效事实 |
| 历史档案查询困难 | 每年归档为 PerformanceRecord JSON 快照，按分公司+年度一键 ZIP 导出 |
| 申报资格人工核查 | 自动预审规则：入职年限 → 能级等级 → 申报范围校验 |

### 1.3 用户角色

```
                    ┌─────────┐
                    │  ADMIN  │  超级管理员（全局配置、模板设计、数据导入导出）
                    └────┬────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
   ┌────┴────┐    ┌──────┴──────┐   ┌─────┴─────┐
   │EMPLOYEE │    │REVIEWER_L1  │   │REVIEWER_L2│
   │ 普通员工 │    │ 分公司审核员 │   │ 总公司审核员│
   └─────────┘    └─────────────┘   └───────────┘
```

| 角色 | 权限范围 |
|------|----------|
| `EMPLOYEE` | 选择已发布模板申报、查看历史记录、编辑被驳回项、查看个人年度档案 |
| `REVIEWER_L1` | 审核本分公司（`scopeBranchId`）已提交申报，逐项通过/驳回 |
| `REVIEWER_L2` | 审核所有 L1 已通过的申报（总公司视角），终审通过后自动归档 |
| `ADMIN` | 组织架构管理、模板设计、用户与角色分配、通知渠道配置、评分规则配置、数据导入导出、报表分析、自动预审规则配置 |

---

## 二、功能模块总览

```
┌─────────────────────────────────────────────────────────────┐
│                    企业员工绩效申报系统                        │
├──────────┬──────────┬──────────┬──────────┬─────────────────┤
│ 系统配置  │ 组织架构  │ 模板管理  │ 用户管理  │   绩效申报       │
│ ──────── │ ──────── │ ──────── │ ──────── │  ─────────────  │
│ 首次引导  │ 分公司   │ 章节设计  │ 员工注册  │ 模板选择         │
│ 通知渠道  │ 部门     │ 申报项    │ 角色分配  │ 逐项填报         │
│ 登录策略  │ 岗位     │ 分值档次  │ 批量导入  │ 附件上传         │
│          │ 工种     │ 发布/归档 │          │ 草稿/提交        │
│          │ 能级     │          │          │                  │
├──────────┼──────────┼──────────┼──────────┼─────────────────┤
│ 定量评分  │ 审核管理  │ 数据导入  │ 数据导出  │   报表分析       │
│ ──────── │ ──────── │ ──────── │ ──────── │  ─────────────  │
│ 评分规则  │ 待审列表  │ 缺陷治理  │ 按分公司  │ 按模板统计        │
│ 维度配置  │ 逐项审核  │ 两票执行  │ 按年度   │ 审核进度          │
│ 自动预审  │ 审核审计  │ 安全贡献  │ ZIP 流式  │ 维度得分          │
│ 能级计算  │ 审核审计  │ 用户导入  │          │                  │
└──────────┴──────────┴──────────┴──────────┴─────────────────┘
```

---

## 三、详细功能需求

### 3.1 系统初始化与配置

#### 3.1.1 首次管理员引导 (`/admin/setup`)

- **触发条件**: 系统中不存在任何 `ADMIN` 角色用户
- **流程**: 填写姓名、联系方式、密码 → 创建首个 ADMIN → 自动跳转管理员登录
- **安全**: 一旦存在 ADMIN，该页面不可访问

#### 3.1.2 通知渠道配置 (`/admin/notify`)

- **单例模式**: 全局唯一配置（`NotifyConfig.id = 1`），二选一：
  - **阿里云短信 (SMS)**: 配置 AccessKey + 签名 + 模板码，密钥 AES-256-GCM 加密存储
  - **SMTP 邮件 (EMAIL)**: 配置 SMTP 服务器 + 账号密码，密钥 AES-256-GCM 加密存储
- **影响范围**: 用户注册、找回密码、审核通知均使用所选渠道
- **运行时切换**: 管理员切换后实时生效，但已有用户联系方式类型不兼容

#### 3.1.3 登录验证策略配置 (`/admin/auth`)

- 验证码开关：控制登录/注册是否需要短信/邮件验证码
- 强密码规则：密码复杂度策略配置

### 3.2 组织架构管理 (`/admin/organization`)

五级组织实体的 CRUD 管理：

| 实体 | 关键字段 | 说明 |
|------|---------|------|
| 分公司 (Branch) | name, code | REVIEWER_L1 的审核范围边界 |
| 部门 (Department) | name, branchId | 归属分公司 |
| 岗位 (Position) | name | 用户岗位 |
| 工种 (JobType) | name | 用户工种 |
| 能级 (EmployeeLevel) | name | 用户能级，用于申报等级校验 |

### 3.3 申报表模板设计器 (`/admin/templates`)

#### 3.3.1 模板生命周期

```
DRAFT → PUBLISHED → ARCHIVED
  │        │
  └─── 可编辑 ──→  员工可见   →  历史封存
```

#### 3.3.2 层级结构

```
FormTemplate（模板）
  ├── year: 评价年度
  ├── title: 模板标题
  ├── status: DRAFT | PUBLISHED | ARCHIVED
  └── FormSection（章节）× N
        ├── sortOrder: 排序
        ├── title: 章节名称
        ├── description: 章节说明
        └── FormItem（申报项）× N
              ├── type: SCORE（分档选择）| TEXT（自由填写）| COMBO（混合）
              ├── maxScore: 满分
              ├── dimensionCode: 系统维度码（用于定量评分关联）
              ├── options: 分值档次 [{label, score}]
              └── FormOptionReviewer: 按选项级指定审核人
```

#### 3.3.3 章节级审核人

- 每个章节可指定专属审核人（`SectionReviewer`）
- 支持按 section + option 组合指定审核人（`FormOptionReviewer`）

### 3.4 用户管理 (`/admin/users`)

#### 3.4.1 用户列表与角色分配

- 查看所有用户及其当前角色
- 分配 `REVIEWER_L1`（需指定分公司 scope）或 `REVIEWER_L2`
- 角色复合唯一约束：`[userId, role, scopeBranchId]`

#### 3.4.2 用户批量导入 (`/admin/users/import`)

- 上传 CSV（工号、姓名、入职日期）
- 自动计算能级等级（基于工龄：0-4年→一级，5-7年→二级，8年+→三级）
- 新建用户无密码，必须通过注册认领（用工号作为临时 contact）
- 已有用户仅更新信息，保留原有密码和联系方���

#### 3.4.3 员工自助注册 (`/register`)

- 验证码注册（短信或邮箱，取决于通知渠道）
- 自动获得 `EMPLOYEE` 角色
- 绑定联系人方式到用户记录

### 3.5 绩效申报（员工端）

#### 3.5.1 申报入口 (`/app`)

- 展示所有 `PUBLISHED` 状态的模板
- 已提交/草稿/已驳回的申报历史列表
- 个人年度绩效档案查看

#### 3.5.2 填报页 (`/app/submission/[templateId]`)

- **逐章节渲染**：每个章节展示其下的申报项
- **分值选择**：SCORE 型申报项从预设分档中选择
- **文本备注**：TEXT 型自由填写
- **附件上传**：每个申报项可上传多个附件到 MinIO
  - 存储路径：`submissions/{submissionId}/{itemId}/{uuid}-{filename}`
- **草稿保存**：随时保存，状态为 `DRAFT`
- **提交**：状态变为 `SUBMITTED`，触发自动预审

#### 3.5.3 驳回重提

- 被驳回的申报，仅被驳回项可编辑，其余项锁定
- 重提后，仅改动项需再次审核（其余项保留原审核结果）
- 状态流转：`REJECTED` → `RESUBMITTED`

#### 3.5.4 自动预审规则 (`/admin/auto-review-rules`)

提交时自动校验，基于工龄与申报能级的匹配：

| 规则要素 | 说明 |
|---------|------|
| 工龄区间 | `minWorkYears` / `maxWorkYears` |
| 允许能级 | `allowedLevelIds[]` |
| 拒绝消息 | `rejectMessage` |

> 预审未通过 → 不阻断提交（软提示），员工可见 warnings，审核员可见预审结果作为参考。原因：入职时间数据可能不准确，硬阻断会把合法申报挡在门外，人为审核兜底。

### 3.6 两级审核 (`/app/review`)

#### 3.6.1 审核工作台

```
SUBMITTED → L1_REVIEWING → L1_APPROVED → L2_REVIEWING → APPROVED → 归档
                 │                              │
                 └── REJECTED ←─────────────────┘
```

#### 3.6.2 逐项审核

- 每个 `SubmissionItem` 独立审核决策（PASS / REJECT）
- 驳回时可填写理由
- `ReviewLog` 记录每次审核操作

#### 3.6.3 审核权限

- `REVIEWER_L1`: 只能看见 `scopeBranchId` 匹配的分公司申报
- `REVIEWER_L2`: 可以看见所有 `L1_APPROVED` 的申报（总公司视角）

#### 3.6.4 归档

- L2 全部通过后自动生成 `PerformanceRecord`
- `archivedData`: JSON 快照，包含当时的模板结构和分值
- 后续模板修改不影响已归档记录

### 3.7 定量评分引擎 (`/admin/scoring`)

#### 3.7.1 14 个评价维度

```
基本素质（14分）
  ├── 技能等级 (4分) — 人资2.0系统
  ├── 职称等级 (4分) — 人资2.0系统
  └── 绩效等级 (6分) — 人资2.0系统

工作业绩（44分）
  ├── 安全贡献 (12分) — 安全工作奖惩实施细则
  ├── 技术贡献·国标行标 (12分) — 规范标准修编材料
  ├── 技术贡献·资源库 (12分) — 资源库建设成果
  ├── 竞赛比武·生产竞赛 (10分) — 获奖证书/通报
  ├── 竞赛比武·调考 (10分) — 获奖证书/通报
  ├── 发明创新·奖项 (10分) — 科技创新获奖
  └── 发明创新·论文专利 (10分) — 核心期刊/发明专利

工作现场（42分）
  ├── 两票执行 (30分) — 两票公示汇总（安监部）
  └── 缺陷治理 (12分) — 缺陷库消缺名单（运检部）

特殊事项
  └── 严重/一般违章扣分 — 安监部通报
```

#### 3.7.2 三种评分规则

| 规则类型 | 算法 | 适用场景 |
|---------|------|---------|
| **MATRIX** | 角色 × 缺陷等级 → 固定分数矩阵 | 缺陷治理（危急/严重/一般 × 发现人/处理人） |
| **SHARE** | 按事件分组，角色份额均分，N 处故障 × N | 安全贡献（第一发现人 3分/次 × N） |
| **NORMALIZE** | 原始分 ÷ 能级最高分 × 目标满分 | 两票执行（全年按比例折算） |

#### 3.7.3 评分规则 CRUD API

- `GET /api/admin/scoring-rules`: 列出所有规则 + 维度定义
- `POST /api/admin/scoring-rules`: 创建规则（每个维度唯一，config 按规则类型校验）
- `PUT /api/admin/scoring-rules`: 编辑规则
- `DELETE /api/admin/scoring-rules`: 删除规则

### 3.8 数据导入 (`/admin/import`)

#### 3.8.1 绩效事实导入

支持三种维度的 Excel 批量导入：

| 维度 | 数据源 | 计分方式 |
|------|--------|----------|
| 缺陷治理 | 运检部缺陷库 Excel（编号、等级、发现人、消缺人、时间） | MATRIX |
| 两票执行 | 两票公示汇总 Excel（票种、角色、项数） | NORMALIZE |
| 安全贡献 | 安全突出贡献审批单 Excel | SHARE |

#### 3.8.2 导入流程

```
上传 Excel → 解析行 → 员工匹配（工号+姓名）→ 评分引擎计算 →
生成 PerformanceFact → 写入数据库（upsert: year+employeeNo+dimensionCode+defectRef+role+eventType）
```

### 3.9 数据导出 (`/admin/export`)

- **按分公司 + 年度** 筛选
- **ZIP 流式打包**，不落盘：
  - `manifest.csv`: 人员 + 总分汇总
  - `{employeeNo}-{name}/archive.json`: 个人完整申报数据
  - `{employeeNo}-{name}/`: 附件文件
- 技术实现：archiver 流式 + MinIO 预签名 URL 读取

### 3.10 报表分析 (`/admin/reports`)

- 按表单模板统计已通过员工的分值分布
- 审核进度与结果概览
- 审核审计报告

### 3.11 量化积分报告生成（脚本）

- `scripts/generate-quantitative-report.ts`: 从缺陷库 Excel 生成「量化积分表积分报送表」格式 Excel
- 自动生成随机工号名册、gender、specialty 等个人信息
- 按能级等级分页输出

---

## 四、数据模型核心约束

| # | 约束 | 说明 |
|---|------|------|
| 1 | `NotifyConfig.id = 1` | 通知渠道全局单例 |
| 2 | `Submission [userId, templateId] unique` | 一人一模板只有一份申报（upsert） |
| 3 | `UserRole [userId, role, scopeBranchId] unique` | REVIEWER_L1 限定分公司范围 |
| 4 | `PerformanceRecord [userId, year] unique` | 一人一年一条档案（终态不可变） |
| 5 | `SubmissionItem [submissionId, itemId] unique` | 申报项不重复 |
| 6 | `ScoringRule.dimensionCode unique` | 每个维度仅一个评分规则 |
| 7 | `PerformanceFact [year, employeeNo, dimensionCode, defectRef, role, eventType] unique` | 事实去重 |

---

## 五、技术约束

| 约束 | 值 |
|------|-----|
| 框架 | Next.js 14 App Router |
| 语言 | TypeScript 5.6 strict mode |
| 数据库 | PostgreSQL 16 + Prisma 5.22 ORM |
| 文件存储 | MinIO (S3 兼容) |
| 认证 | JWT (jose) + 双 Cookie（`perf_session` / `perf_session_admin`），7天过期 |
| 校验 | Zod 3 |
| 密码 | bcryptjs |
| 样式 | Tailwind CSS 3.4，组件内联（无共享组件库） |
| 导出 | archiver 流式 ZIP |
| 通知 | 阿里云短信 (HMAC-SHA1) + SMTP 邮件 (nodemailer) |
| 部署 | Docker Compose (PostgreSQL + MinIO + Next.js) |

---

## 六、API 接口清单

### 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/setup` | 检查是否需要首次引导 |
| POST | `/api/setup` | 创建首个 ADMIN |
| POST | `/api/auth/login` | 双入口登录（`?admin=1` 走管理员） |
| POST | `/api/auth/logout` | 清除会话 |
| POST | `/api/auth/register` | 验证码注册 |
| POST | `/api/auth/send-code` | 发送验证码（60s 限频） |
| POST | `/api/auth/reset-password` | 重置密码 |

### 员工端

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/submissions` | 我的申报列表 |
| POST | `/api/submissions` | 创建/更新 + 提交申报 |
| POST | `/api/attachments` | 上传附件到 MinIO |
| DELETE | `/api/attachments` | 删除附件 |

### 审核

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/review` | 待审列表（按角色过滤） |
| POST | `/api/review` | 逐项审核决策 |

### 管理端

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/POST/PUT/DELETE | `/api/admin/templates` | 模板 CRUD |
| GET/POST/PUT/DELETE | `/api/admin/organization` | 组织架构 CRUD |
| GET/PUT | `/api/admin/users` | 用户列表 + 角色分配 |
| POST | `/api/admin/users/import` | 用户批量导入 |
| GET/PUT | `/api/admin/notify-config` | 通知渠道配置 |
| GET/POST/PUT/DELETE | `/api/admin/scoring-rules` | 评分规则 CRUD |
| POST | `/api/admin/import` | 绩效事实导入 |
| GET | `/api/admin/export` | 流式 ZIP 导出 |

---

## 七、待扩展需求

1. **可视化拖拽模板设计器**: 当前为表单字段编辑 + JSON 配置模式
2. **审核员复杂权限矩阵**: 当前为单维度「按分公司」，未来可能扩展部门/岗位交叉
3. **国际化支持**: 当前仅中文 (zh-CN)
4. **移动端适配**: 当前仅桌面端 UI
5. **申诉处理流程**: 员工对被驳回项的申诉与仲裁
6. **实时通知推送**: 审核状态变化的站内信/WebSocket 通知
7. **所有 14 维度的系统导入**: 当前仅实现缺陷治理、两票执行、安全贡献三个维度的自动导入
