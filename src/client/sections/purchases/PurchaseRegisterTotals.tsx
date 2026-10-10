import type { PurchasesPage } from '../../api.ts';
import { purchaseNumber } from './purchaseEditorModel.ts';

export function PurchaseRegisterTotals({ totals }: { totals: PurchasesPage['registerTotals'] }) {
  return <>
    <div className="purchase-grid purchase-register-total purchase-register-grand-total">
      <strong>إجماليات السجل من البداية</strong>
      <span className="purchase-total-result" data-label="إجمالي الناتج">{purchaseNumber.format(totals.resultUnits)}</span>
      <span className="purchase-total-paid" data-label="إجمالي المسدد">{purchaseNumber.format(totals.paidUnits)}</span>
      <span className={`purchase-total-remaining ${totals.remainingUnits > 0 ? 'liability' : totals.remainingUnits < 0 ? 'credit' : 'zero'}`}
        data-label="الباقي الحالي">{purchaseNumber.format(totals.remainingUnits)}</span>
      <span className="purchase-total-consumed" data-label="إجمالي مستهلك فودافون">{purchaseNumber.format(totals.vodafoneConsumedUnits)}</span>
    </div>
    <div className="purchase-grid purchase-register-total purchase-vodafone-total">
      <strong>باقي فودافون كاش الحالي</strong>
      <span className="purchase-total-consumed" data-label="باقي فودافون كاش">{purchaseNumber.format(totals.vodafoneRemainingUnits)}</span>
    </div>
  </>;
}
