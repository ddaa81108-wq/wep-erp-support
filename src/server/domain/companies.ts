import type { AppDatabase } from '../db/database.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';
import {
  addCustomerTransaction,
  cancelCustomerTransaction,
  correctCustomerTransaction,
  createCustomer,
  customerSnapshot,
  customerLedger,
  listCustomers,
  setCustomerPinned,
  updateCustomerDetails,
} from './customers.ts';

export const listCompanies = (database: AppDatabase, url: URL, organizationId: string) =>
  listCustomers(database, url, organizationId, 'company');
export const companyLedger = (database: AppDatabase, id: string, url: URL, organizationId: string) =>
  customerLedger(database, id, url, organizationId, 'company');
export const companySnapshot = (database: AppDatabase, id: string, organizationId: string) =>
  customerSnapshot(database, id, organizationId, 'company');

export const createCompany = (
  database: AppDatabase, actor: AuthenticatedUser, input: Record<string, unknown>, correlationId: string,
) => createCustomer(database, actor, input, correlationId, 'company');

export const updateCompanyDetails = (
  database: AppDatabase, actor: AuthenticatedUser, id: string, input: Record<string, unknown>, correlationId: string,
) => updateCustomerDetails(database, actor, id, input, correlationId, 'company');

export const addCompanyTransaction = (
  database: AppDatabase, actor: AuthenticatedUser, id: string, input: Record<string, unknown>, correlationId: string,
) => addCustomerTransaction(database, actor, id, input, correlationId, 'company');

export const correctCompanyTransaction = (
  database: AppDatabase, actor: AuthenticatedUser, id: string, transactionId: string,
  input: Record<string, unknown>, correlationId: string,
) => correctCustomerTransaction(database, actor, id, transactionId, input, correlationId, 'company');

export const cancelCompanyTransaction = (
  database: AppDatabase, actor: AuthenticatedUser, id: string, transactionId: string,
  input: Record<string, unknown>, correlationId: string,
) => cancelCustomerTransaction(database, actor, id, transactionId, input, correlationId, 'company');

export const setCompanyPinned = (
  database: AppDatabase, actor: AuthenticatedUser, id: string, input: Record<string, unknown>, correlationId: string,
) => setCustomerPinned(database, actor, id, input, correlationId, 'company');
