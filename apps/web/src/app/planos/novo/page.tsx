import type { Metadata } from 'next';
import { PlanEditor } from '../plan-editor';

export const metadata: Metadata = { title: 'Novo plano' };

export default function NewPlanPage() {
  return <PlanEditor />;
}
