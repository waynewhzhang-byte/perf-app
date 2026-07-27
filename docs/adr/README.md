# Architecture Decision Records

记录本项目中**难以回退**、**令人费解**、**真实权衡**的架构决策。格式约定见
`/Users/Zhuanz/.agents/skills/domain-modeling/ADR-FORMAT.md`（极简：1-3 句话即可）。

新增 ADR：取当前目录最大编号 +1，文件名 `NNNN-kebab-slug.md`。

## 索引

| # | 决策 | 状态 |
|---|------|------|
| [0001](./0001-sms-only-notify-channel.md) | SMS 为唯一通知渠道，EMAIL 仅作代码预留 | accepted |
| [0002](./0002-archive-as-json-snapshot.md) | 绩效档案用归档快照而非实时 join | accepted |
| [0003](./0003-one-submission-per-template.md) | 一人一模板一份申报，upsert 覆盖 | accepted |
| [0004](./0004-template-immutable-after-publish.md) | 模板发布后内容完全不可变（可复制为草稿） | accepted |
| [0005](./0005-option-level-review.md) | 审核单位是 SubmissionOptionReview（逐选项） | accepted（系统填充维度见 0008 收窄） |
| [0006](./0006-pre-review-non-blocking.md) | 预审为软提示，不阻断提交 | accepted |
| [0007](./0007-dimension-code-as-binding-key.md) | dimensionCode 作为模板/事实/审核的绑定键 | accepted |
| [0008](./0008-appeal-only-review-for-system-filled.md) | 系统填充维度只审申诉，无异议直通归档 | accepted |

## 说明

本目录记录项目中**难以回退**、**令人费解**、**真实权衡**的架构决策，是决策的权威记录。
