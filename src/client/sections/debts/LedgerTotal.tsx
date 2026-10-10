import type { Ledger } from '../../api.ts';
import { currencyLabel, isDepositSection } from './debtSectionUtils.ts';
import { ledgerMoney } from './ledgerModel.ts';
import { debtSectionText, type DebtSection } from './sectionConfig.ts';

export function LedgerTotal({ section, ledger }: { section: DebtSection; ledger: Ledger }) {
  const balance = ledger.customer.balanceUnits;
  const label = isDepositSection(section)
    ? balance > 0
      ? debtSectionText[section].positiveLabel
      : balance < 0
        ? debtSectionText[section].negativeLabel
        : 'الحساب صفر'
    : balance < 0
      ? debtSectionText[section].trustLabel
      : 'إجمالي الدين الحالي';

  return (
    <div className="ledger-grid ledger-footer-grid">
      <div className={`ledger-total ${balance < 0 ? 'credit-total' : ''}`}>
        <span>{label}</span>
        <strong>
          {ledgerMoney.format(Math.abs(balance))} <small>{currencyLabel(section)}</small>
        </strong>
        <em>{balance === 0 ? 'الحساب مسدّد' : `التالي #${ledger.customer.nextSequence}`}</em>
      </div>
    </div>
  );
}
