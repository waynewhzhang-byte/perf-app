/** 两票执行按工区归并的专业分组。 */
const TICKET_SPECIALTY_BY_WORK_AREA: Record<string, string> = {
  '变电检修中心': '专业1',
  '设备状态测试中心': '专业1',
  '晋北运维分部': '专业2',
  '晋南运维分部': '专业2',
  '晋中运维分部': '专业2',
  '特高压北岳站': '专业3',
  '特高压大同站': '专业3',
  '特高压洪善站': '专业3',
  '特高压长治站': '专业3',
  '二次检修中心': '专业4',
  '特高压雁门关换流站': '专业5',
  '智能运检管控中心': '专业6',
};

/** 根据员工所属工区取得两票折算专业；未配置工区不与其他工区混算。 */
export function ticketSpecialtyFromWorkArea(workArea: string | null | undefined): string {
  const name = workArea?.trim();
  if (!name) return '未配置工区';
  return TICKET_SPECIALTY_BY_WORK_AREA[name] ?? `未配置工区：${name}`;
}
