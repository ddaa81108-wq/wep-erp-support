import type { User } from '../api.ts';
import type { MainSection } from '../sections/debts/sectionConfig.ts';
import { canReadSection } from '../../shared/sections.ts';

const allowed = (user: User, permission: string) => user.permissions?.includes(permission) === true;

export function employeeCanOpenSection(user: User, section: MainSection) {
  return canReadSection(user.permissions, section);
}

export function initialEmployeeSection(user: User): MainSection {
  if (allowed(user, 'collections.read')) return 'collections';
  if (allowed(user, 'debts.read')) return 'customers';
  if (allowed(user, 'companies.read')) return 'companies';
  if (allowed(user, 'libyan_deposits.read')) return 'libyan-deposits';
  if (allowed(user, 'egyptian_deposits.read')) return 'egyptian-deposits';
  if (allowed(user, 'masraweya.read')) return 'masraweya';
  if (allowed(user, 'purchases.read')) return 'purchases';
  if (allowed(user, 'treasury.read')) return 'treasury';
  if (allowed(user, 'reports.read')) return 'reports';
  return 'collections';
}

export function employeeHasPermission(user: User, permission: string) {
  return allowed(user, permission);
}
