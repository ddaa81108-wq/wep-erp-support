import { uiText } from '../../i18n/language.ts';
import { purchaseNumber } from './purchaseEditorModel.ts';

export function PurchaseCarryRow({ balance, partial = false }: { balance: number | null; partial?: boolean }) {
  const label = partial ? uiText('الرصيد السابق للمعاملات المعروضة') : uiText('الباقي المرحّل من اليوم السابق');
  return (
    <div className="purchase-grid purchase-day-opening">
      <span className="purchase-carry-label">{label}</span>
      <strong className="purchase-carry-value" dir="ltr" aria-label={label}>
        {balance === null ? '—' : purchaseNumber.format(balance)}
      </strong>
    </div>
  );
}
