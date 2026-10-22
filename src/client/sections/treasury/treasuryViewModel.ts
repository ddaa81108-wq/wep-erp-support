import { uiText } from '../../i18n/language.ts';
import type { TreasuryDashboard } from '../../api.ts';

export const treasuryNumberFormat = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
});

export type TreasuryCard = Readonly<{
  label: string;
  value: number | null;
  note: string;
  kind: 'receivable' | 'liability' | 'active-cash' | 'egyptian' | 'net';
}>;

export function treasuryCards(dashboard: TreasuryDashboard): readonly TreasuryCard[] {
  return [
    {
      label: uiText("إجمالي الديون لنا"),
      value: dashboard.receivablesUnits,
      note: uiText("غير نشط — العملاء والشركات"),
      kind: 'receivable',
    },
    {
      label: uiText("إجمالي الديون علينا"),
      value: dashboard.liabilitiesUnits,
      note: uiText("غير نشط — المشتريات والأمانات الليبية"),
      kind: 'liability',
    },
    {
      label: uiText("الفلوس النشطة"),
      value: dashboard.activeCashUnits,
      note: uiText("يتغير بالدخول والخروج فقط"),
      kind: 'active-cash',
    },
    {
      label: uiText("ترحيلات الأمانات المصرية"),
      value: dashboard.egyptianConvertedUnits,
      note: dashboard.egyptianRate
        ? uiText("{0} ج.م ÷ {1}", [treasuryNumberFormat.format(dashboard.egyptianSourceUnits), dashboard.egyptianRate])
        : uiText("يلزم سعر تحويل معتمد"),
      kind: 'egyptian',
    },
    {
      label: uiText("صافي الخزينة الشامل"),
      value: dashboard.netUnits,
      note: uiText("ديون لنا + النشط + المصري − ديون علينا"),
      kind: 'net',
    },
  ];
}
