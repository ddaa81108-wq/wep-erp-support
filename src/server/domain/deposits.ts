import type { AppDatabase } from '../db/database.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';
import {
  addCustomerTransaction, cancelCustomerTransaction, correctCustomerTransaction,
  createCustomer, customerLedger, customerSnapshot, listCustomers, setCustomerPinned, updateCustomerDetails,
  type DebtPartyKind,
} from './customers.ts';

export type DepositSection = 'libyan-deposits' | 'egyptian-deposits';
export const depositKind = (section: DepositSection): DebtPartyKind => section === 'libyan-deposits' ? 'depositLyd' : 'depositEgp';
export const depositPermission = (section: DepositSection, write = false) =>
  `${section === 'libyan-deposits' ? 'libyan_deposits' : 'egyptian_deposits'}.${write ? 'write' : 'read'}`;

export const listDeposits = (database: AppDatabase, url: URL, organizationId: string, section: DepositSection) =>
  listCustomers(database, url, organizationId, depositKind(section));
export const depositLedger = (database: AppDatabase, id: string, url: URL, organizationId: string, section: DepositSection) =>
  customerLedger(database, id, url, organizationId, depositKind(section));
export const depositSnapshot = (database: AppDatabase, id: string, organizationId: string, section: DepositSection) =>
  customerSnapshot(database, id, organizationId, depositKind(section));
export const createDepositAccount = (database: AppDatabase, actor: AuthenticatedUser, input: Record<string, unknown>, correlationId: string, section: DepositSection) => createCustomer(database, actor, input, correlationId, depositKind(section));
export const updateDepositAccount = (database: AppDatabase, actor: AuthenticatedUser, id: string, input: Record<string, unknown>, correlationId: string, section: DepositSection) => updateCustomerDetails(database, actor, id, input, correlationId, depositKind(section));
export const addDepositMovement = (database: AppDatabase, actor: AuthenticatedUser, id: string, input: Record<string, unknown>, correlationId: string, section: DepositSection) => addCustomerTransaction(database, actor, id, input, correlationId, depositKind(section));
export const correctDepositMovement = (database: AppDatabase, actor: AuthenticatedUser, id: string, transactionId: string, input: Record<string, unknown>, correlationId: string, section: DepositSection) => correctCustomerTransaction(database, actor, id, transactionId, input, correlationId, depositKind(section));
export const cancelDepositMovement = (database: AppDatabase, actor: AuthenticatedUser, id: string, transactionId: string, input: Record<string, unknown>, correlationId: string, section: DepositSection) => cancelCustomerTransaction(database, actor, id, transactionId, input, correlationId, depositKind(section));
export const setDepositPinned = (database: AppDatabase, actor: AuthenticatedUser, id: string, input: Record<string, unknown>, correlationId: string, section: DepositSection) => setCustomerPinned(database, actor, id, input, correlationId, depositKind(section));
