export type ReportStatus = 'normal' | 'review' | 'critical' | 'missing_rate';

export type PositionSnapshot = {
  receivablesUnits: number;
  liabilitiesUnits: number;
  activeCashUnits: number;
  egyptianSourceUnits: number;
  egyptianConvertedUnits: number | null;
  egyptianRate: number | null;
  netUnits: number | null;
};

export type ReportReason = {
  key: 'receivables' | 'liabilities' | 'active_cash' | 'egyptian' | 'missing_rate';
  label: string;
  changeUnits: number | null;
};

const LABELS = {
  receivables: 'الديون لنا',
  liabilities: 'الديون علينا',
  active_cash: 'الأموال النشطة',
  egyptian: 'القيمة المصرية المحولة',
} as const;

export function componentReasons(current: PositionSnapshot, previous: PositionSnapshot | null) {
  if (!previous) return [] satisfies ReportReason[];
  const values = [
    ['receivables', current.receivablesUnits - previous.receivablesUnits],
    ['liabilities', -(current.liabilitiesUnits - previous.liabilitiesUnits)],
    ['active_cash', current.activeCashUnits - previous.activeCashUnits],
    [
      'egyptian',
      current.egyptianConvertedUnits === null || previous.egyptianConvertedUnits === null
        ? null
        : current.egyptianConvertedUnits - previous.egyptianConvertedUnits,
    ],
  ] as const;
  return values
    .filter(([, change]) => change === null || change !== 0)
    .map(([key, changeUnits]) => ({ key, label: LABELS[key], changeUnits }))
    .sort((a, b) => Math.abs(b.changeUnits ?? 0) - Math.abs(a.changeUnits ?? 0));
}

export function analyzePosition(
  current: PositionSnapshot,
  previous: PositionSnapshot | null,
  recentAbsoluteChanges: number[],
) {
  if (current.netUnits === null) {
    return {
      status: 'missing_rate' as const,
      changeUnits: null,
      changePercent: null,
      summary: 'التقرير غير مكتمل لأن سعر تحويل الجنيه المصري غير محدد.',
      reasons: [{ key: 'missing_rate', label: 'سعر التحويل المصري غير محدد', changeUnits: null }] satisfies ReportReason[],
    };
  }
  if (!previous || previous.netUnits === null) {
    return {
      status: 'normal' as const,
      changeUnits: null,
      changePercent: null,
      summary: 'هذا أول يوم محفوظ في السجل؛ سيظهر الفرق ابتداءً من اليوم التالي.',
      reasons: [] satisfies ReportReason[],
    };
  }
  const changeUnits = current.netUnits - previous.netUnits;
  const base = Math.abs(previous.netUnits);
  const changePercent = base === 0 ? null : (changeUnits / base) * 100;
  const sorted = [...recentAbsoluteChanges].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] ?? 0 : 0;
  const reviewThreshold = Math.max(5_000, Math.round(base * 0.08), median * 3);
  const criticalThreshold = Math.max(20_000, Math.round(base * 0.2), median * 6);
  const status: ReportStatus =
    changeUnits <= -criticalThreshold
      ? 'critical'
      : changeUnits <= -reviewThreshold
        ? 'review'
        : 'normal';
  const direction = changeUnits === 0 ? 'لم يتغير' : changeUnits > 0 ? 'ارتفع' : 'انخفض';
  const warning = status === 'critical'
    ? ' الانخفاض كبير جدًا ويحتاج مراجعة فورية للقيود والمصادر.'
    : status === 'review'
      ? ' الانخفاض يتجاوز الحد المعتاد ويحتاج مراجعة.'
      : '';
  return {
    status,
    changeUnits,
    changePercent,
    summary: `صافي المركز المالي ${direction} مقارنة باليوم السابق.${warning}`,
    reasons: componentReasons(current, previous),
  };
}
