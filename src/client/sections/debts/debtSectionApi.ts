import { api, type CustomerListOptions } from '../../api.ts';
import type { DebtSection } from './sectionConfig.ts';
import { isDepositSection } from './debtSectionUtils.ts';

type CreateAccountBody = { name: string; phone?: string; openingBalance: number; requestId: string };
type UpdateAccountBody = { expectedVersion: number; name: string; phone?: string };
type PinBody = { expectedVersion: number; isPinned: boolean };
type CancelBody = { requestId: string; expectedVersion: number; reason?: string };

export const listSectionAccounts = (section: DebtSection, options?: CustomerListOptions) => {
  if (isDepositSection(section)) return api.depositAccounts(section, options);
  if (section === 'companies') return api.companies(options);
  return api.customers(options);
};

export const listSectionSuggestions = (section: DebtSection, query: string) => {
  if (isDepositSection(section)) return api.depositAccountSuggestions(section, query);
  if (section === 'companies') return api.companySuggestions(query);
  return api.customerSuggestions(query);
};

export const getSectionAccount = (section: DebtSection, id: string) => {
  if (isDepositSection(section)) return api.depositAccount(section, id);
  if (section === 'companies') return api.company(id);
  return api.customer(id);
};

export const getSectionLedger = (section: DebtSection, id: string, before?: string | null) => {
  if (isDepositSection(section)) return api.depositLedger(section, id, before);
  if (section === 'companies') return api.companyLedger(id, before);
  return api.ledger(id, before);
};

export const createSectionAccount = (section: DebtSection, body: CreateAccountBody) => {
  if (isDepositSection(section)) return api.createDepositAccount(section, body);
  if (section === 'companies') return api.createCompany(body);
  return api.createCustomer(body);
};

export const updateSectionAccount = (section: DebtSection, id: string, body: UpdateAccountBody) => {
  if (isDepositSection(section)) return api.updateDepositAccount(section, id, body);
  if (section === 'companies') return api.updateCompany(id, body);
  return api.updateCustomer(id, body);
};

export const setSectionPinned = (section: DebtSection, id: string, body: PinBody) => {
  if (isDepositSection(section)) return api.setDepositPinned(section, id, body);
  if (section === 'companies') return api.setCompanyPinned(id, body);
  return api.setCustomerPinned(id, body);
};

export const addSectionTransaction = (section: DebtSection, id: string, body: Record<string, unknown>) => {
  if (isDepositSection(section)) return api.depositMovement(section, id, body);
  if (section === 'companies') return api.companyTransaction(id, body);
  return api.transaction(id, body);
};

export const editSectionTransaction = (section: DebtSection, id: string, transactionId: string, body: Record<string, unknown>) => {
  if (isDepositSection(section)) return api.editDepositMovement(section, id, transactionId, body);
  if (section === 'companies') return api.editCompanyTransaction(id, transactionId, body);
  return api.editTransaction(id, transactionId, body);
};

export const cancelSectionTransaction = (section: DebtSection, id: string, transactionId: string, body: CancelBody) => {
  if (isDepositSection(section)) return api.cancelDepositMovement(section, id, transactionId, { requestId: body.requestId, expectedVersion: body.expectedVersion });
  if (section === 'companies') return api.cancelCompanyTransaction(id, transactionId, body);
  return api.cancelTransaction(id, transactionId, body);
};
