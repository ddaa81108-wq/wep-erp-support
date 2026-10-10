import type { Customer } from '../../api.ts';
import type { DebtSection } from './sectionConfig.ts';
import { SECTION_CONTRACTS } from '../../../shared/sections.ts';

export type DepositSection = Extract<DebtSection, 'libyan-deposits' | 'egyptian-deposits'>;

export const isDepositSection = (section: DebtSection): section is DepositSection => (
  section === 'libyan-deposits' || section === 'egyptian-deposits'
);

export const currencyLabel = (section: DebtSection) => section === 'egyptian-deposits' ? 'ج.م' : 'د.ل';

export const permissionPrefixFor = (section: DebtSection) => {
  const permission = SECTION_CONTRACTS[section].readPermission;
  return permission?.replace(/\.read$/, '') ?? 'debts';
};

export const orderCustomerCards = (items: Customer[]) => [...items].sort((left, right) => {
  const zeroOrder = Number(left.balanceUnits === 0) - Number(right.balanceUnits === 0);
  if (zeroOrder !== 0) return zeroOrder;
  return new Date(right.updatedAt ?? right.createdAt).getTime() - new Date(left.updatedAt ?? left.createdAt).getTime();
});
