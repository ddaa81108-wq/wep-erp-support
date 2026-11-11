export type TreasuryDashboard = {
  currency: 'LYD';
  receivablesUnits: number;
  liabilitiesUnits: number;
  activeCashUnits: number;
  egyptianSourceUnits: number;
  egyptianConvertedUnits: number | null;
  egyptianRate: number | null;
  egyptianRateUpdatedAt: string | null;
  netUnits: number | null;
  cashVersion: number;
  sources: {
    customers: number;
    companies: number;
    purchases: number;
    libyanDeposits: number;
    egyptianDeposits: number;
  };
};

export type TreasuryCashEntry = {
  id: string;
  sequence: number;
  direction: 'in' | 'out';
  amountUnits: number;
  description: string;
  balanceBeforeUnits: number;
  balanceAfterUnits: number;
  actorName: string;
  actorIsOwner: boolean;
  createdAt: string;
  correctionOf?: { id: string; sequence: number } | null;
  correction?: {
    revision: number;
    direction: 'in' | 'out';
    amountUnits: number;
    description: string;
    reason: string;
    correctedAt: string;
    correctedBy: string;
  } | null;
};

export type TreasuryCorrectionInput = {
  requestId: string;
  expectedVersion: number;
  expectedEntryRevision: number;
  direction: 'in' | 'out';
  amountUnits: number;
  description: string;
  reason: string;
};
