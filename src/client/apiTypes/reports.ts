export type ReportStatus = 'normal' | 'review' | 'critical' | 'missing_rate';

export type DailyFinancialReport = {
  sequence: number;
  businessDate: string;
  receivablesUnits: number;
  liabilitiesUnits: number;
  activeCashUnits: number;
  egyptianSourceUnits: number;
  egyptianConvertedUnits: number | null;
  egyptianRate: number | null;
  netUnits: number | null;
  daily: {
    receivablesAddedUnits: number;
    paymentsUnits: number;
    liabilitiesEffectUnits: number;
    cashInUnits: number;
    cashOutUnits: number;
  };
  status: ReportStatus;
  summary: string;
  reasons: { key: string; label: string; changeUnits: number | null }[];
  version: number;
  generatedAt: string;
  updatedAt: string;
  isFinalized: boolean;
  finalizedAt: string | null;
};

export type ReportsDashboard = {
  current: DailyFinancialReport | null;
  items: DailyFinancialReport[];
  methodology: { formula: string; note: string; currency: 'LYD' };
};
