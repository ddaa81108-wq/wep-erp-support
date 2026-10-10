export type AuditEntry = {
  id: number;
  action: string;
  entityType: string;
  entityId: string | null;
  correlationId: string;
  outcome: 'success' | 'denied' | 'failure';
  details: Record<string, unknown>;
  actorName: string;
  actorUsername: string | null;
  createdAt: string;
};

export type FinancialLedgerEntry = {
  id: number;
  sourceKind: string;
  sourceId: string;
  sectionKey: string;
  entryKind: string;
  counterpartyName: string;
  description: string;
  referenceNo: string;
  currency: 'LYD' | 'EGP';
  amountUnits: number;
  effectUnits: number;
  actorName: string;
  actorUsername: string | null;
  occurredAt: string;
  sourceStatus: string;
  updatedAt: string;
};
