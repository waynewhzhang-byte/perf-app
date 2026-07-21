# 0005 — 审核单位是 SubmissionOptionReview（逐选项），非整申报项

**Status:** accepted (2026-06-13)

L2 终审的审核粒度是 `SubmissionOptionReview`——每个申报项的每个选中分值产生一条独立审核记录，
**不**以整个 `SubmissionItem` 为单位批量通过/驳回。L1 仍是逐 `SubmissionItem` APPROVE/REJECT，
L2 才下沉到 option 级。

原因：每个被选中的分值都对应一份需要核对的事实证据（如某次缺陷处理的角色份额），
混在整项里 APPROVE 会丢失"这一项的这两个分值核对过了、第三个有问题"的细粒度信号。
按 option 审核让驳回能精确指到具体分值，员工重提时也只需重做被驳的那个。

代价：审核记录数随选项数膨胀，UI 与查询复杂度高于整项审核；L2 工作量明显增加。
被认为是必要的——L1 已经做了整项过滤，L2 的事实核对本质上就是细粒度的。
