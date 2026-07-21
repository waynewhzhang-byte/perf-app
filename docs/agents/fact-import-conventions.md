# 事实数据写入规范

> 所有 `EmployeeBasicFact` / `PerformanceFact` 的业务写入必须经统一的 batch-replace seam。
> 本文档是 agent 与人类开发者共同遵守的契约。

## 一、唯一允许的写入 seam

| 模型 | seam 函数 | 文件 | scope |
|---|---|---|---|
| `PerformanceFact` | `replaceFactsBySource` | `src/lib/performance-fact-repository.ts` | `(year, dimensionCode, sourceFile)` |
| `EmployeeBasicFact` | `replaceBasicFactsBySource` | `src/lib/basic-fact-repository.ts` | `(year, dimension, sourceFile)` |

两个 seam 语义对称：
1. 事务内先 `deleteMany` 清空该 scope 下的旧记录
2. 按唯一键去重（后写覆盖）
3. `createMany` 分块写入（每块 200 行）

**重新上传同一份文件 = 整体替换**，文件中不再出现的旧事实会被删除。这是设计意图——
避免孤儿事实污染后续归档分计算。

## 二、必须遵守的规则

### ✅ 允许

- 所有 `/api/admin/import/*` 路由最后调 seam（已实现：basic / defects / safety / tickets /
  tech / competition / innovation / patent / violation 共 9 个维度）
- 一次性恢复/补导脚本调 seam（如 `src/lib/restore-2026/performance-level.ts`）
- 调用方负责构造正确的 `PerformanceFactSeed[]` / `BasicFactSeed[]`，特别是：
  - `defectRef` 必须含足够信息确保唯一性（如专利名+顺序、规程名+工号）
  - 工号无效的行在 build 阶段过滤掉

### ❌ 禁止

- 直接 `prisma.performanceFact.create/upsert/update` 写业务事实
- 直接 `prisma.employeeBasicFact.create/upsert/update` 写业务事实
- 一次性脚本绕过 seam 直写 DB（`scripts/restore-2026-performance-facts.ts` 已废弃）
- 在 build 阶段不做 defectRef 唯一化，依赖 dedupeSeeds 兜底（会导致同人多次参与被合并）

### ⚠️ 唯一例外：申诉修正

`src/app/api/admin/fact-corrections/route.ts` 是唯一允许单条 `create/update` 的路径，
因为申诉修正是逐条审计场景（一次只改一条，需保留修改前后快照）。文件头已注明豁免理由。

## 三、已知的 defectRef 唯一性陷阱

| 维度 | 陷阱 | 正确做法 |
|---|---|---|
| 发明专利 | 同一员工在不同专利任同一序号发明人（如李勇 4 个专利都是第 1 发明人） | defectRef = `patent:order{N}:{专利名}` |
| 运规编写 | 同一员工参与多个不同规程 | defectRef = `tech:{dim}:{规程名}:{工号}` |
| 安全贡献 | 同一员工在同一事件的多个角色 | 按 incidentId 分组后由 SHARE 规则均分，每员工 1 条 |
| 创新奖项 | 同一员工获同一奖项的多次 | defectRef 含 award + project |

## 四、业务边界（已确认）

| 议题 | 决定 | 影响 |
|---|---|---|
| 政工师/经济师/工程技术人员 职称给分 | 按等级同级给分（中级=3） | 5 人边界 |
| 发明专利计分人数 | 前 4 人 4/3/2/1 | 与 xlsx 一致 |
| 国标/行标/地标/企标 + 典操/应急预案 | 维持不实现 | 无源数据，等业务方提供 |

## 五、回归校验

每次导入后建议跑：
```bash
pnpm verify:imported-scores
```
脚本会重算源 XLSX 的期望分数与 DB 对比，输出差异报告（详见
`scripts/verify-imported-scores.ts`）。

## 六、相关代码

- seam 本体：`src/lib/performance-fact-repository.ts`、`src/lib/basic-fact-repository.ts`
- 共用写入 wrapper：`src/lib/fact-import-common.ts`（5 个新维度用）
- 维度专属导入器：`src/lib/{basic-fact,defect-governance,safety-contribution,
  ticket-execution,tech-contrib,competition,innovation,patent,violation}-import.ts`
- API 路由：`src/app/api/admin/import/*/route.ts`
- 前端：`src/app/admin/import/_shared/{ImportWizard,parse,field-specs,types}.tsx`
