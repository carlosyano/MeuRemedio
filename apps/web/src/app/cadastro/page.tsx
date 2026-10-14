import type { Metadata } from 'next';
import { SignupForm } from './signup-form';

export const metadata: Metadata = { title: 'Criar conta' };

export default function SignupPage() {
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold">Criar conta</h1>
      <SignupForm />
    </>
  );
}
