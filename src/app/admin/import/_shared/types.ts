export type ItemCode =
  | 'employees'
  | 'basic'
  | 'tickets'
  | 'defects'
  | 'safety'
  | 'tech-textbook'
  | 'tech-regulation'
  | 'tech-ticket-revision'
  | 'competition'
  | 'innovation'
  | 'patent'
  | 'violation';

export interface FieldSpec {
  key: string;
  label: string;
  required: boolean;
  hint?: string;
  /** Excel/CSV 表头别名（精确匹配，优先于模糊匹配） */
  headerAliases?: string[];
}

export interface ImportItemConfig {
  code: ItemCode;
  title: string;
  description: string;
  dependsOn: string;
  fields: FieldSpec[];
  apiEndpoint: string;
  /** 查询参数（追加到 apiEndpoint，如 ?kind=regulation） */
  apiEndpointParams?: Record<string, string>;
  requireFullBatch?: boolean;
  hasScorePreview: boolean;
}
