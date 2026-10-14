import type { Metadata } from 'next';
import { EmailRequestForm } from '@/components/email-request-form';

export const metadata: Metadata = { title: 'Reenviar confirmação' };

export default function ResendVerificationPage() {
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold">Reenviar confirmação</h1>
      <p className="mb-4">Informe o e-mail usado no cadastro para receber um novo link.</p>
      <EmailRequestForm path="/accounts/verification-resends" />
    </>
  );
}
