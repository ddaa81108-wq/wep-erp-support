import { DebtAccountsView } from '../DebtAccountsView.tsx';
import type { DebtPageProps } from './debtPageTypes.ts';

export function EgyptianDepositsSection(props: DebtPageProps) {
  return <DebtAccountsView {...props} section="egyptian-deposits" />;
}
