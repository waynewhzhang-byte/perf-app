export type ItemCode = 'employees' | 'basic' | 'tickets' | 'defects' | 'safety';

export interface FieldSpec {
  key: string;
  label: string;
  required: boolean;
  hint?: string;
}

export interface ImportItemConfig {
  code: ItemCode;
  title: string;
  description: string;
  dependsOn: string;
  fields: FieldSpec[];
  apiEndpoint: string;
  requireFullBatch?: boolean;
  hasScorePreview: boolean;
}
