import { DebtAccountsView } from '../DebtAccountsView.tsx';
import type { DebtPageProps } from './debtPageTypes.ts';

export function CompanyDebtsSection(props: DebtPageProps) {
  return <DebtAccountsView {...props} section="companies" />;
}
