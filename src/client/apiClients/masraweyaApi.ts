import { request } from '../apiTransport.ts';
import type { MasraweyaDay } from '../apiTypes.ts';

export const masraweyaApi = {
  masraweyaDay: (date?: string) =>
    request<MasraweyaDay>(`/api/masraweya/day${date ? `?date=${encodeURIComponent(date)}` : ''}`),
  saveMasraweyaDay: (body: {
    businessDate: string;
    expectedVersion: number;
    previousValueUnits: number;
    purchasesUnits: number;
    entries: Array<{ valueUnits: number; commissionUnits: number }>;
  }) =>
    request<MasraweyaDay & { eventSequences: number[] }>('/api/masraweya/day', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  finalizeMasraweyaDay: (businessDate: string, expectedVersion: number) =>
    request<MasraweyaDay & { eventSequences: number[] }>('/api/masraweya/day/finalize', {
      method: 'POST',
      body: JSON.stringify({ businessDate, expectedVersion }),
    }),
  setMasraweyaDayCorrection: (body: { businessDate: string; expectedVersion: number; open: boolean; reason?: string }) =>
    request<MasraweyaDay & { eventSequences: number[] }>('/api/masraweya/day/correction', {
      method: 'POST', body: JSON.stringify(body),
    }),
};
