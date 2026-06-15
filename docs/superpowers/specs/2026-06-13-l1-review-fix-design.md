# L1 审核逐项决策 — 修复设计

## 背景

2026-06-13 深度业务逻辑分析（grill-me，30 轮交互）确认：L1 审核存在"双路径"缺陷——
`overallAction`（整表驳回）和逐项决策同时存在，审核员点"整表驳回"会绕过所有逐项决策，
导致已投入时间的逐项审核工作被覆盖，且员工无法区分"已通过项"和"驳回项"。

## 问题根因

`review/route.ts` 的 Schema 同时接受 `overallAction` + `decisions[]`，
前端暴露"整表/表头结论" radio 和"全部通过/全部驳回"快捷按钮。
当 `overallAction === 'REJECT'` 时，服务端忽略 `decisions[]`，直接将全部 pending items 置为 REJECTED。

## 修复方案

### 后端 (`src/app/api/review/route.ts`)

1. Schema 移除 `overallAction: z.enum(['APPROVE', 'REJECT']).optional()` 和 `overallNote: z.string().optional()`
2. 删除 `overallAction === 'REJECT'` 分支（bulk-reject early return）
3. 保留逐项决策循环：每个 pending item 单独 APPROVE / REJECT
4. 校验不变：全部 pending items 必须有决策，驳回项必须填写原因

### 前端 (`src/app/app/review/page.tsx`)

1. 移除 `overallAction` / `overallNote` state
2. 移除 `setAll()` 函数
3. 移除"全部通过"/"全部驳回"快捷按钮
4. 移除"整表/表头结论" radio 区块
5. `submit()` 只发送 `{ submissionId, decisions }`

## 变更后 L1 审核流程

```
L1 审核员打开待审申报
  → 逐项过目：每项选择 APPROVE 或 REJECT（驳回须写原因）
  → 全部决策完毕 → 点击"提交审核结论"
  → 服务端事务：
    - APPROVED 项 → status: L1_APPROVED（员工锁定）
    - REJECTED 项 → status: REJECTED（员工可修改）
    - 存在 REJECT → Submission: REJECTED
    - 全部 APPROVE → Submission: L1_APPROVED → 创建 SubmissionOptionReview → 流入 L2

员工重提：
  → L1_APPROVED 项跳过（lockedItemIds）
  → REJECTED 项可修改 → 重新提交 → 仅改动项 PENDING_L1 再次审核
```

## 不变的部分

- L2 审核逻辑完全不变（L2 无整表驳回概念，已按部门逐 option 决策）
- 驳回重提锁定逻辑不变（`submissions/route.ts` lines 219-223）
- 预审软提示不阻断（工龄数据可能不准，人审兜底）

## 影响范围

| 文件 | 变更类型 |
|------|---------|
| `src/app/api/review/route.ts` | Schema 缩减 + 删除 bulk-reject 路径 |
| `src/app/app/review/page.tsx` | 移除 overallAction UI + 快捷按钮 |

## 验证点

1. L1 审核员对部分项 APPROVE、部分 REJECT → Submission REJECTED，APPROVED 项不可编辑
2. 员工重提 → 仅 REJECTED 项可修改，APPROVED 项锁定
3. 重提后 L1 审核 → 仅见 PENDING_L1 项（之前的改动项）
4. L2 审核不受影响
