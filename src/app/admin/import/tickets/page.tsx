'use client';
import { useState } from 'react';
import TicketImportWizard from './TicketImportWizard';

export default function TicketsImportPage() {
  const [year] = useState(new Date().getFullYear());
  return <TicketImportWizard year={year} />;
}
