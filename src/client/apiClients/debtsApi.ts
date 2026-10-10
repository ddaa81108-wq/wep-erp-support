import { customerListPath, ledgerPath } from '../apiPaths.ts';
import { request } from '../apiTransport.ts';
import type { AccountSuggestion, Customer, CustomerListOptions, CustomerListResult, Ledger, LedgerItem } from '../apiTypes.ts';

type AccountBody = { name: string; phone?: string; openingBalance: number; requestId: string };
type AccountUpdate = { expectedVersion: number; name: string; phone?: string };
type CancelBody = { requestId: string; expectedVersion: number; reason?: string };
type AccountResult = { customerId: string; name: string; phone: string | null; customerVersion: number };
type TransactionResult = { transaction: LedgerItem; customerVersion: number; balanceUnits: number };

export const debtsApi = {
  customers: (options?: CustomerListOptions) =>
    request<CustomerListResult>(customerListPath('/api/customers', options)),
  customerSuggestions: (query: string) => request<{ items: AccountSuggestion[] }>(`/api/customers/suggestions?q=${encodeURIComponent(query)}`),
  customer: (customerId: string) => request<Customer>(`/api/customers/${encodeURIComponent(customerId)}`),
  createCustomer: (body: AccountBody) =>
    request<{ customer: Customer }>('/api/customers', { method: 'POST', body: JSON.stringify(body) }),
  updateCustomer: (customerId: string, body: AccountUpdate) =>
    request<AccountResult>(`/api/customers/${encodeURIComponent(customerId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  ledger: (customerId: string, before?: string | null) =>
    request<Ledger>(ledgerPath(`/api/customers/${encodeURIComponent(customerId)}/ledger`, before)),
  transaction: (customerId: string, body: Record<string, unknown>) =>
    request<TransactionResult>(`/api/customers/${encodeURIComponent(customerId)}/transactions`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  editTransaction: (customerId: string, transactionId: string, body: Record<string, unknown>) =>
    request<TransactionResult>(
      `/api/customers/${encodeURIComponent(customerId)}/transactions/${encodeURIComponent(transactionId)}/corrections`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  cancelTransaction: (customerId: string, transactionId: string, body: CancelBody) =>
    request<{ transactionId: string; status: 'reversed'; customerVersion: number; balanceUnits: number }>(
      `/api/customers/${encodeURIComponent(customerId)}/transactions/${encodeURIComponent(transactionId)}/cancel`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  setCustomerPinned: (customerId: string, body: { expectedVersion: number; isPinned: boolean }) =>
    request<{ customerId: string; isPinned: boolean; customerVersion: number }>(
      `/api/customers/${encodeURIComponent(customerId)}/pin`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),

  companies: (options?: CustomerListOptions) =>
    request<CustomerListResult>(customerListPath('/api/companies', options)),
  companySuggestions: (query: string) => request<{ items: AccountSuggestion[] }>(`/api/companies/suggestions?q=${encodeURIComponent(query)}`),
  company: (companyId: string) => request<Customer>(`/api/companies/${encodeURIComponent(companyId)}`),
  createCompany: (body: AccountBody) =>
    request<{ customer: Customer }>('/api/companies', { method: 'POST', body: JSON.stringify(body) }),
  updateCompany: (companyId: string, body: AccountUpdate) =>
    request<AccountResult>(`/api/companies/${encodeURIComponent(companyId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  companyLedger: (companyId: string, before?: string | null) =>
    request<Ledger>(ledgerPath(`/api/companies/${encodeURIComponent(companyId)}/ledger`, before)),
  companyTransaction: (companyId: string, body: Record<string, unknown>) =>
    request<TransactionResult>(`/api/companies/${encodeURIComponent(companyId)}/transactions`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  editCompanyTransaction: (companyId: string, transactionId: string, body: Record<string, unknown>) =>
    request<TransactionResult>(
      `/api/companies/${encodeURIComponent(companyId)}/transactions/${encodeURIComponent(transactionId)}/corrections`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  cancelCompanyTransaction: (companyId: string, transactionId: string, body: CancelBody) =>
    request<{ transactionId: string; status: 'reversed'; customerVersion: number; balanceUnits: number }>(
      `/api/companies/${encodeURIComponent(companyId)}/transactions/${encodeURIComponent(transactionId)}/cancel`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  setCompanyPinned: (companyId: string, body: { expectedVersion: number; isPinned: boolean }) =>
    request<{ customerId: string; isPinned: boolean; customerVersion: number }>(
      `/api/companies/${encodeURIComponent(companyId)}/pin`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),
};
