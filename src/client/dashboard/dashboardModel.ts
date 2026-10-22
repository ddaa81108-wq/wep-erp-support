import { uiText } from '../i18n/language.ts';
import { ApiError, type Customer, type CustomerFilter, type User } from '../api.ts';
import type { DebtSection, MainSection } from '../sections/debts/sectionConfig.ts';
import { employeeCanOpenSection, initialEmployeeSection } from '../employee/employeeNavigationModel.ts';

const ADMIN_SECTIONS = new Set<MainSection>([
  'customers',
  'companies',
  'libyan-deposits',
  'egyptian-deposits',
  'collections',
  'masraweya',
  'purchases',
  'treasury',
  'reports',
  'settings',
]);

export function dashboardErrorText(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return uiText("حدث خطأ غير متوقع. لم تُعتمد العملية.");
}

export function initialDashboardSection(user: User, stored: string | null): MainSection {
  if (stored) {
    const section = stored as MainSection;
    if (user.role === 'admin' ? ADMIN_SECTIONS.has(section) : employeeCanOpenSection(user, section)) {
      return section;
    }
  }
  return user.role === 'admin' ? 'customers' : initialEmployeeSection(user);
}

export function debtSectionFor(section: MainSection): DebtSection {
  if (
    section === 'settings' ||
    section === 'collections' ||
    section === 'masraweya' ||
    section === 'purchases' ||
    section === 'treasury'
    || section === 'reports'
  ) return 'customers';
  return section;
}

export function visibleCustomerCards(
  customers: Customer[],
  query: string,
  filter: CustomerFilter,
) {
  const normalizedQuery = query.toLocaleLowerCase('ar');
  return customers.filter((item) => {
    const matchesSearch = `${item.name} ${item.phone ?? ''}`
      .toLocaleLowerCase('ar')
      .includes(normalizedQuery);
    if (!matchesSearch) return false;
    if (filter === 'pending-review') return item.balanceUnits === 0 && Boolean(item.zeroReview?.pending);
    if (normalizedQuery) return true;
    if (filter === 'smart') return !item.hiddenFromDefault;
    if (filter === 'today') return true;
    if (filter === 'due') return item.balanceUnits > 0;
    if (filter === 'settled') return item.balanceUnits === 0;
    if (filter === 'pinned') return item.isPinned;
    return false;
  });
}
