import { request } from '../apiTransport.ts';
import type { TreasuryCashEntry, TreasuryDashboard } from '../apiTypes.ts';

export const treasuryApi = {
  treasury: () => request<TreasuryDashboard>('/api/treasury'),
  treasuryCashLedger: (before?: number | null) =>
    request<{ items: TreasuryCashEntry[]; nextBefore: number | null }>(
      `/api/treasury/cash-ledger${before ? `?before=${before}` : ''}`,
    ),
  addTreasuryCashEntry: (body: {
    requestId: string;
    expectedVersion: number;
    direction: 'in' | 'out';
    amountUnits: number;
    description: string;
  }) =>
    request<{ entry: TreasuryCashEntry; cashVersion: number; activeCashUnits: number }>(
      '/api/treasury/cash-entries',
      { method: 'POST', body: JSON.stringify(body) },
    ),
};
