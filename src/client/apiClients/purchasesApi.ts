import { request } from '../apiTransport.ts';
import type { PurchaseEntryInput, PurchaseMerchantKey, PurchasesPage } from '../apiTypes.ts';

export const purchasesApi = {
  purchases: (merchant: PurchaseMerchantKey, before?: number | null, known?:readonly string[]) =>
    request<PurchasesPage>(`/api/purchases/${merchant}?limit=100${before ? `&before=${before}` : ''}${known?.length?`&known=${encodeURIComponent(known.join(','))}`:''}`),
  createPurchase: (merchant: PurchaseMerchantKey, body: PurchaseEntryInput) =>
    request(`/api/purchases/${merchant}`, { method: 'POST', body: JSON.stringify(body) }),
  updatePurchase: (
    merchant: PurchaseMerchantKey,
    id: string,
    body: PurchaseEntryInput & { expectedVersion: number },
  ) =>
    request(`/api/purchases/${merchant}/entries/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deletePurchase: (
    merchant: PurchaseMerchantKey,
    id: string,
    body: { requestId: string; expectedVersion: number; expectedDayVersion: number },
  ) =>
    request(`/api/purchases/${merchant}/entries/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      body: JSON.stringify(body),
    }),
  setPurchaseOpening: (
    merchant: PurchaseMerchantKey,
    body: { expectedDayVersion: number; previousDebtUnits: number; previousVodafoneUnits: number },
  ) => request(`/api/purchases/${merchant}/opening`, { method: 'PATCH', body: JSON.stringify(body) }),
  finalizePurchaseDay: (
    merchant: PurchaseMerchantKey,
    body: { requestId: string; expectedDayVersion: number },
  ) => request(`/api/purchases/${merchant}/finalize`, { method: 'POST', body: JSON.stringify(body) }),
  setPurchaseDayCorrection: (
    merchant: PurchaseMerchantKey,
    dayId: string,
    body: { open: boolean; expectedVersion: number },
  ) =>
    request(`/api/purchases/${merchant}/days/${encodeURIComponent(dayId)}/correction`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
};
