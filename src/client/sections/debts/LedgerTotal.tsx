import { uiText } from '../../i18n/language.ts';
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
        : uiText("الحساب صفر")
    : balance < 0
      ? debtSectionText[section].trustLabel
      : uiText("إجمالي الدين الحالي");

  return (
    <div className="ledger-grid ledger-footer-grid">
      <div className={`ledger-total ${balance < 0 ? 'credit-total' : ''}`} data-balance-owner={balance === 0 ? 'zero' : (section === 'libyan-deposits' ? balance > 0 : balance < 0) ? 'customer' : 'system'} data-balance-sign={balance > 0 ? 'positive' : balance < 0 ? 'negative' : 'zero'}>
        <span>{label}</span>
        <strong>
          {ledgerMoney.format(Math.abs(balance))} <small>{currencyLabel(section)}</small>
        </strong>
        <em>{balance === 0 ? uiText("الحساب مسدّد") : uiText("التالي #{0}", [ledger.customer.nextSequence])}</em>
      </div>
    </div>
  );
}
