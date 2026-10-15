import type { Metadata } from 'next';
import { HistoryScreen } from './history-screen';

export const metadata: Metadata = { title: 'Histórico' };

export default function HistoryPage() {
  return <HistoryScreen />;
}
