'use client';
import { useState } from 'react';
import ImportWizard from '../_shared/ImportWizard';
import { getItemConfig } from '../_shared/field-specs';

export default function PatentImportPage() {
  const [year] = useState(new Date().getFullYear());
  return <ImportWizard config={getItemConfig('patent')} year={year} />;
}
