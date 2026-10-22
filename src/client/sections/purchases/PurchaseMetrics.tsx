import { uiText } from '../../i18n/language.ts';
import type { PurchasesPage } from '../../api.ts';
import { purchaseNumber } from './purchaseEditorModel.ts';

export function PurchaseMetrics({ day }: { day: PurchasesPage['day'] }) {
  return (
    <div className="purchase-metrics">
      <article className={day.previousDebtUnits > 0 ? 'positive liability' : day.previousDebtUnits < 0 ? 'negative credit' : 'zero'}>
        <span>{uiText("القيمة السابقة")}</span>
        <b dir="ltr">{purchaseNumber.format(day.previousDebtUnits)} {uiText(" د.ل")}</b>
      </article>
      <article>
        <span>{uiText("إجمالي شغل اليوم")}</span>
        <b dir="ltr">{purchaseNumber.format(day.todayResultUnits)} {uiText(" د.ل")}</b>
      </article>
      <article>
        <span>{uiText("إجمالي المسدد")}</span>
        <b dir="ltr">{purchaseNumber.format(day.todayPaidUnits)} {uiText(" د.ل")}</b>
      </article>
      <article className={day.totalDebtUnits > 0 ? 'positive liability' : day.totalDebtUnits < 0 ? 'negative credit' : 'zero'}>
        <span>{uiText("إجمالي الديون")}</span>
        <b dir="ltr">{purchaseNumber.format(day.totalDebtUnits)} {uiText(" د.ل")}</b>
      </article>
      <article className={`vodafone ${day.vodafoneRemainingUnits > 0 ? 'credit' : day.vodafoneRemainingUnits < 0 ? 'liability' : 'zero'}`}>
        <span>{day.vodafoneRemainingUnits > 0 ? uiText("باقي فودافون لصالحنا") : day.vodafoneRemainingUnits < 0 ? uiText("استهلاك فودافون علينا") : uiText("باقي فودافون كاش")}</span>
        <b dir="ltr">{purchaseNumber.format(Math.abs(day.vodafoneRemainingUnits))} {uiText(" ج.م")}</b>
      </article>
    </div>
  );
}
