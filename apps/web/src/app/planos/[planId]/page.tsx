import type { Metadata } from 'next';
import { PlanEditor } from '../plan-editor';

export const metadata: Metadata = { title: 'Editar plano' };

export default async function EditPlanPage({
  params,
}: {
  readonly params: Promise<{ readonly planId: string }>;
}) {
  const { planId } = await params;
  return <PlanEditor planId={planId} />;
}
