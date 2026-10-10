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
      label: 'إجمالي الديون لنا',
      value: dashboard.receivablesUnits,
      note: 'غير نشط — العملاء والشركات',
      kind: 'receivable',
    },
    {
      label: 'إجمالي الديون علينا',
      value: dashboard.liabilitiesUnits,
      note: 'غير نشط — المشتريات والأمانات الليبية',
      kind: 'liability',
    },
    {
      label: 'الفلوس النشطة',
      value: dashboard.activeCashUnits,
      note: 'يتغير بالدخول والخروج فقط',
      kind: 'active-cash',
    },
    {
      label: 'ترحيلات الأمانات المصرية',
      value: dashboard.egyptianConvertedUnits,
      note: dashboard.egyptianRate
        ? `${treasuryNumberFormat.format(dashboard.egyptianSourceUnits)} ج.م ÷ ${dashboard.egyptianRate}`
        : 'يلزم سعر تحويل معتمد',
      kind: 'egyptian',
    },
    {
      label: 'صافي الخزينة الشامل',
      value: dashboard.netUnits,
      note: 'ديون لنا + النشط + المصري − ديون علينا',
      kind: 'net',
    },
  ];
}
