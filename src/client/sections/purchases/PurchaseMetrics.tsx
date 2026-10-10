import type { PurchasesPage } from '../../api.ts';
import { purchaseNumber } from './purchaseEditorModel.ts';

export function PurchaseMetrics({ day }: { day: PurchasesPage['day'] }) {
  return (
    <div className="purchase-metrics">
      <article className={day.previousDebtUnits >= 0 ? 'positive' : 'negative'}>
        <span>القيمة السابقة</span>
        <b dir="ltr">{purchaseNumber.format(day.previousDebtUnits)} د.ل</b>
      </article>
      <article>
        <span>إجمالي شغل اليوم</span>
        <b dir="ltr">{purchaseNumber.format(day.todayResultUnits)} د.ل</b>
      </article>
      <article>
        <span>إجمالي المسدد</span>
        <b dir="ltr">{purchaseNumber.format(day.todayPaidUnits)} د.ل</b>
      </article>
      <article className={day.totalDebtUnits >= 0 ? 'positive' : 'negative'}>
        <span>إجمالي الديون</span>
        <b dir="ltr">{purchaseNumber.format(day.totalDebtUnits)} د.ل</b>
      </article>
      <article className={`vodafone ${day.vodafoneRemainingUnits > 0 ? 'credit' : day.vodafoneRemainingUnits < 0 ? 'liability' : 'zero'}`}>
        <span>{day.vodafoneRemainingUnits > 0 ? 'باقي فودافون لصالحنا' : day.vodafoneRemainingUnits < 0 ? 'استهلاك فودافون علينا' : 'باقي فودافون كاش'}</span>
        <b dir="ltr">{purchaseNumber.format(Math.abs(day.vodafoneRemainingUnits))} ج.م</b>
      </article>
    </div>
  );
}
