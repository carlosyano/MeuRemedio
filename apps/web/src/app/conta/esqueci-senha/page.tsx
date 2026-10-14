import type { Metadata } from 'next';
import { EmailRequestForm } from '@/components/email-request-form';

export const metadata: Metadata = { title: 'Esqueci minha senha' };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold">Esqueci minha senha</h1>
      <p className="mb-4">Informe o e-mail da conta para receber um link de redefinição.</p>
      <EmailRequestForm path="/password-reset-requests" />
    </>
  );
}
