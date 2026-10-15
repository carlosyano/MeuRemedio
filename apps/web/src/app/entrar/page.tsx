import Link from 'next/link';
import type { Metadata } from 'next';
import { safeNext } from '@/lib/safe-next';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Entrar' };

export default async function LoginPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { proximo } = await searchParams;
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold">Entrar</h1>
      <LoginForm next={safeNext(typeof proximo === 'string' ? proximo : undefined)} />
      <ul className="mt-6 space-y-2">
        <li>
          <Link href="/conta/esqueci-senha">Esqueci minha senha</Link>
        </li>
        <li>
          Ainda não tem conta? <Link href="/cadastro">Criar conta</Link>
        </li>
      </ul>
    </>
  );
}
