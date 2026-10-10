import { customerListPath, ledgerPath } from '../apiPaths.ts';
import { request } from '../apiTransport.ts';
import type { AccountSuggestion, Customer, CustomerListOptions, CustomerListResult, Ledger, LedgerItem } from '../apiTypes.ts';

type DepositSection = 'libyan-deposits' | 'egyptian-deposits';

export const depositsApi = {
  depositAccounts: (section: DepositSection, options?: CustomerListOptions) =>
    request<CustomerListResult>(customerListPath(`/api/${section}`, options)),
  depositAccountSuggestions: (section: DepositSection, query: string) =>
    request<{ items: AccountSuggestion[] }>(`/api/${section}/suggestions?q=${encodeURIComponent(query)}`),
  createDepositAccount: (
    section: DepositSection,
    body: { name: string; phone?: string; openingBalance: number; requestId: string },
  ) => request<{ customer: Customer }>(`/api/${section}`, { method: 'POST', body: JSON.stringify(body) }),
  depositAccount: (section: DepositSection, id: string) =>
    request<Customer>(`/api/${section}/${encodeURIComponent(id)}`),
  updateDepositAccount: (
    section: DepositSection,
    id: string,
    body: { expectedVersion: number; name: string; phone?: string },
  ) =>
    request<{ customerId: string; name: string; phone: string | null; customerVersion: number }>(
      `/api/${section}/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),
  depositLedger: (section: DepositSection, id: string, before?: string | null) =>
    request<Ledger>(ledgerPath(`/api/${section}/${encodeURIComponent(id)}/ledger`, before)),
  depositMovement: (section: DepositSection, id: string, body: Record<string, unknown>) =>
    request<{ transaction: LedgerItem; customerVersion: number; balanceUnits: number }>(
      `/api/${section}/${encodeURIComponent(id)}/transactions`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  editDepositMovement: (
    section: DepositSection,
    id: string,
    transactionId: string,
    body: Record<string, unknown>,
  ) =>
    request<{ transaction: LedgerItem; customerVersion: number; balanceUnits: number }>(
      `/api/${section}/${encodeURIComponent(id)}/transactions/${encodeURIComponent(transactionId)}/corrections`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  cancelDepositMovement: (
    section: DepositSection,
    id: string,
    transactionId: string,
    body: { requestId: string; expectedVersion: number },
  ) =>
    request<{ transactionId: string; status: 'reversed'; customerVersion: number; balanceUnits: number }>(
      `/api/${section}/${encodeURIComponent(id)}/transactions/${encodeURIComponent(transactionId)}/cancel`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  setDepositPinned: (
    section: DepositSection,
    id: string,
    body: { expectedVersion: number; isPinned: boolean },
  ) =>
    request<{ customerId: string; isPinned: boolean; customerVersion: number }>(
      `/api/${section}/${encodeURIComponent(id)}/pin`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),
  egyptianDepositRate: () =>
    request<{
      sourceCurrency: 'EGP';
      targetCurrency: 'LYD';
      egpPerLyd: number | null;
      updatedAt: string | null;
      activeForTreasury: true;
    }>('/api/egyptian-deposits/exchange-rate'),
  setEgyptianDepositRate: (egpPerLyd: number) =>
    request<{
      sourceCurrency: 'EGP';
      targetCurrency: 'LYD';
      egpPerLyd: number;
      updatedAt: string;
      activeForTreasury: true;
    }>('/api/egyptian-deposits/exchange-rate', {
      method: 'PATCH',
      body: JSON.stringify({ egpPerLyd }),
    }),
};
