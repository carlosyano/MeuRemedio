import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ExportScreen } from './export-screen';

export const metadata: Metadata = { title: 'Exportar histórico' };

export default function ExportPage() {
  return (
    <Suspense fallback={<p aria-live="polite">Carregando…</p>}>
      <ExportScreen />
    </Suspense>
  );
}
