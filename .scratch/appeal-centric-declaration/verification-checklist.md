# Appeal-centric declaration — verification checklist

配套计划：`docs/plans/2026-07-23-appeal-centric-declaration.md`  
自动化：`e2e/t03-appeal-smoke.spec.ts`、`e2e/t04-affirm-t05-review.spec.ts`、`e2e/t07-notice-support-phone.spec.ts`

## Automated (preferred)

```bash
pnpm e2e e2e/t03-appeal-smoke.spec.ts e2e/t04-affirm-t05-review.spec.ts e2e/t07-notice-support-phone.spec.ts --workers=1
```

| ID | 覆盖 |
|----|------|
| T03 | 申诉保存 / 删除 / 编辑 / reload |
| T04 | AFFIRM 确认报名 → 直通归档；L1 待审无该工号 |
| T05 | APPEAL 送审 → L1 表格筛选 / 批量确认 / 已审核「确认」 |
| T07 | 强制阅读弹窗 + 技术支持电话 |

## Manual fallback（自动化环境不可用时）

### AFFIRM（T04）

- [ ] 申报页无已保存申诉时「提交审核」灰、「确认报名」可用
- [ ] 确认弹窗文案含「直接生成年度绩效档案」
- [ ] 确认后首页状态为终审通过/已归档
- [ ] L1 申诉工作台按工号筛选无待审行

### 审核台（T05）

- [ ] 保存至少 1 条申诉后仅「提交审核」可用
- [ ] 送审后 L1 待审核表格出现对应申诉行（工号/申诉项/内容/主张分）
- [ ] 关键字筛选生效
- [ ] 勾选后「批量确认」离开待审；已审核列显示「确认」
- [ ] （可选）批量驳回须填原因，整单退回员工

### 回归

- [ ] `pnpm test`
- [ ] `pnpm lint`
