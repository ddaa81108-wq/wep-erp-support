export type ReportSourceKey = 'customers' | 'companies' | 'libyan' | 'egyptian' | 'purchases' | 'cash';
export type ReportActivityGroup = 'all' | ReportSourceKey;
export type ReportSource = {
  key: ReportSourceKey;
  label: string;
  currency: 'LYD' | 'EGP';
  balanceUnits: number;
  count: number;
  linkedCount: number;
  explanation: string;
};
export type ReportClosing = {
  businessDate: string;
  capturedAt: string;
  netUnits: number | null;
  changeUnits: number | null;
  reasons: { label: string; changeUnits: number | null }[];
};
export type ReportOverview = {
  generatedAt: string;
  businessDate: string;
  timezone: string;
  position: {
    receivablesUnits: number;
    liabilitiesUnits: number;
    cashUnits: number;
    egyptianUnits: number;
    convertedUnits: number | null;
    rate: number | null;
    rateUpdatedAt: string | null;
    netUnits: number | null;
  };
  sources: ReportSource[];
  daily: {
    debtsUnits: number;
    paymentsUnits: number;
    purchasesUnits: number;
    purchasePaymentsUnits: number;
    cashInUnits: number;
    cashOutUnits: number;
    movementCount: number;
  };
  attention: {
    pendingCount: number;
    pendingUnits: number;
    outstandingCount: number;
    outstandingUnits: number;
    currencyMismatchCount: number;
  };
  closings: ReportClosing[];
  latestClosing: { state: 'recorded' | 'missing_rate' | 'pending' | 'missed'; businessDate: string; scheduledAt: string; netUnits: number | null };
};
export type ReportActivity = {
  items: {
    id: number;
    sourceId: string;
    sourceKey: string;
    sectionKey: string;
    entryKind: string;
    name: string;
    description: string;
    actorName: string;
    occurredAt: string;
    currency: 'LYD' | 'EGP';
    amountUnits: number;
    effectUnits: number;
  }[];
  page: number;
  hasMore: boolean;
  businessDate: string;
};
export type ReportSourceDetails = {
  items: { id: string; name: string; balanceUnits: number; linked: boolean }[];
  page: number;
  hasMore: boolean;
};
