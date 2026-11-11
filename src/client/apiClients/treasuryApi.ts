import { request } from '../apiTransport.ts';
import type { TreasuryCashEntry, TreasuryDashboard } from '../apiTypes.ts';
import type { TreasuryCorrectionInput } from '../apiTypes/treasury.ts';

export const treasuryApi = {
  correctTreasuryCashEntry: (id: string,body: TreasuryCorrectionInput) =>
    request<{activeCashUnits:number;cashVersion:number;deltaUnits:number}>(`/api/treasury/cash-entries/${encodeURIComponent(id)}/corrections`,{
      method:'POST',body:JSON.stringify(body),
    }),
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
