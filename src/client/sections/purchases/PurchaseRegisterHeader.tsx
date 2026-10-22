import { uiText } from '../../i18n/language.ts';
export function PurchaseRegisterHeader() {
  return (
    <div className="purchase-grid purchase-grid-head">
      <span>{uiText("التسلسل")}</span><span>{uiText("النوع")}</span><span>{uiText("القيمة ج.م")}</span><span>{uiText("العملية")}</span>
      <span>{uiText("السعر")}</span><span>{uiText("الناتج")}</span><span>{uiText("المسدد")}</span><span>{uiText("الباقي")}</span>
      <span>{uiText("مستهلك فودافون")}</span><span>{uiText("الإجراءات")}</span>
    </div>
  );
}
