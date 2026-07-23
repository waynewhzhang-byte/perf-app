/** 员工申诉弹窗：按章节分组的可申诉系统项 */

export interface AppealCascadeItem {
  itemId: string;
  itemTitle: string;
  sectionTitle: string;
  sectionCode?: string | null;
  totalScore: number;
}

export function groupAppealCascadeItems(
  items: AppealCascadeItem[],
): Array<{ sectionTitle: string; items: AppealCascadeItem[] }> {
  const bySection = new Map<string, AppealCascadeItem[]>();
  for (const item of items) {
    const key = item.sectionTitle || '其他';
    const list = bySection.get(key) ?? [];
    list.push(item);
    bySection.set(key, list);
  }
  return Array.from(bySection.entries()).map(([sectionTitle, sectionItems]) => ({
    sectionTitle,
    items: sectionItems,
  }));
}
