import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PlansScreen } from './plans-screen';

export const metadata: Metadata = { title: 'Planos' };

export default function PlansPage() {
  return (
    <Suspense fallback={<p aria-live="polite">Carregando…</p>}>
      <PlansScreen />
    </Suspense>
  );
}
