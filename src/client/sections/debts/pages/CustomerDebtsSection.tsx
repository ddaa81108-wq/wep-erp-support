import { DebtAccountsView } from '../DebtAccountsView.tsx';
import type { DebtPageProps } from './debtPageTypes.ts';

export function CustomerDebtsSection(props: DebtPageProps) {
  return <DebtAccountsView {...props} section="customers" />;
}
