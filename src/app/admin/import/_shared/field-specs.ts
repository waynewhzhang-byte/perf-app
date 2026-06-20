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
