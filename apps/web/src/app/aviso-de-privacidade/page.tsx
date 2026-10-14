import type { Metadata } from 'next';
import { PRIVACY_NOTICE_VERSION } from '@/lib/legal';

export const metadata: Metadata = { title: 'Aviso de privacidade' };

// Texto provisorio para desenvolvimento (DC-053): a versao final depende do parecer juridico e de
// privacidade (GX-001 a GX-006) e substitui esta pagina antes de qualquer uso com dados reais.
export default function PrivacyNoticePage() {
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold">Aviso de privacidade</h1>
      <p className="mb-4">Versão {PRIVACY_NOTICE_VERSION} (provisória).</p>
      <p className="mb-4">
        Texto provisório para desenvolvimento e testes. A versão final depende de parecer jurídico e
        de privacidade e será publicada antes do uso com dados reais.
      </p>
      <p>
        Os prazos de retenção vigentes e o canal para exercer seus direitos ficam na área de
        privacidade da sua conta.
      </p>
    </>
  );
}
