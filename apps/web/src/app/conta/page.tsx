import type { Metadata } from 'next';
import { AccountScreen } from './account-screen';

export const metadata: Metadata = { title: 'Conta' };

export default function AccountPage() {
  return <AccountScreen />;
}
