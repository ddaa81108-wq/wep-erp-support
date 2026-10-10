import { DebtAccountsView } from '../DebtAccountsView.tsx';
import type { DebtPageProps } from './debtPageTypes.ts';

export function LibyanDepositsSection(props: DebtPageProps) {
  return <DebtAccountsView {...props} section="libyan-deposits" />;
}
