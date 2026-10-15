import type { Metadata } from 'next';
import { PrivacyScreen } from './privacy-screen';

export const metadata: Metadata = { title: 'Privacidade' };

export default function PrivacyPage() {
  return <PrivacyScreen />;
}
