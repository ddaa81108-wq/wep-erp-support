import { uiText } from '../../i18n/language.ts';
import type { PurchasesPage } from '../../api.ts';
import { purchaseNumber } from './purchaseEditorModel.ts';

export function PurchaseRegisterTotals({ totals }: { totals: PurchasesPage['registerTotals'] }) {
  return <>
    <div className="purchase-grid purchase-register-total purchase-register-grand-total">
      <strong>{uiText("إجماليات السجل من البداية")}</strong>
      <span className="purchase-total-result" data-label={uiText("إجمالي الناتج")}>{purchaseNumber.format(totals.resultUnits)}</span>
      <span className="purchase-total-paid" data-label={uiText("إجمالي المسدد")}>{purchaseNumber.format(totals.paidUnits)}</span>
      <span className={`purchase-total-remaining ${totals.remainingUnits > 0 ? 'liability' : totals.remainingUnits < 0 ? 'credit' : 'zero'}`}
        data-label={uiText("الباقي الحالي")}>{purchaseNumber.format(totals.remainingUnits)}</span>
      <span className="purchase-total-consumed" data-label={uiText("إجمالي مستهلك فودافون")}>{purchaseNumber.format(totals.vodafoneConsumedUnits)}</span>
    </div>
    <div className="purchase-grid purchase-register-total purchase-vodafone-total">
      <strong>{uiText("باقي فودافون كاش الحالي")}</strong>
      <span className="purchase-total-consumed" data-label={uiText("باقي فودافون كاش")}>{purchaseNumber.format(totals.vodafoneRemainingUnits)}</span>
    </div>
  </>;
}
