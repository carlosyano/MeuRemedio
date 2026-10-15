import type { Metadata } from 'next';
import { VerifyScreen } from './verify-screen';

export const metadata: Metadata = { title: 'Confirmar e-mail' };

export default function VerifyPage() {
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold">Confirmar e-mail</h1>
      <VerifyScreen />
    </>
  );
}
