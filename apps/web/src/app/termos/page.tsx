import type { Metadata } from 'next';
import { TERMS_VERSION } from '@/lib/legal';

export const metadata: Metadata = { title: 'Termos de uso' };

// Texto provisorio para desenvolvimento (DC-053): a versao final depende do parecer juridico
// (GX-001 a GX-006) e substitui esta pagina antes de qualquer uso com dados reais.
export default function TermsPage() {
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold">Termos de uso</h1>
      <p className="mb-4">Versão {TERMS_VERSION} (provisória).</p>
      <p className="mb-4">
        Texto provisório para desenvolvimento e testes. A versão final depende de parecer jurídico e
        será publicada antes do uso com dados reais.
      </p>
      <p>
        O MeuRemedio registra a rotina de medicamentos que você declara. Ele não prescreve, não
        valida medicamentos e não substitui orientação profissional.
      </p>
    </>
  );
}
