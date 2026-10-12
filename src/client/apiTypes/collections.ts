export type CollectionAssignment = {
  id: string;
  customerId: string;
  assigneeUserId: string;
  assigneeName: string;
  customerName: string;
  phone: string | null;
  balanceUnits: number;
  hasPending: number;
  assignedAt: string;
  businessDate: string;
  batchId: string;
  latestMode: 'full' | 'partial' | null;
  latestStatus: 'pending' | 'approved' | 'rejected' | null;
  cashOutstandingCount: number;
  latestCashReceivedAt: string | null;
  latestDecisionAt: string | null;
  externalFinancialUpdatedAt: string;
  latestSubmissionAt: string | null;
};

export type CollectionSubmission = {
  id: string;
  assignmentId: string;
  customerId: string;
  collectorUserId: string;
  collectorName: string;
  customerName: string;
  phone: string | null;
  mode: 'full' | 'partial';
  amountUnits: number;
  status: 'pending' | 'approved' | 'rejected';
  submittedAt: string;
  businessDate: string;
  batchId: string;
  decidedAt: string | null;
  decisionNote: string;
  cashReceivedAt: string | null;
};

export type UnlinkedCollectionReceipt = {
  id: string;
  customerName: string;
  collectorName: string;
  amountUnits: number;
  status: 'pending' | 'approved' | 'rejected';
  submittedAt: string;
  businessDate: string;
  batchId: string;
  linkedCustomerId: string | null;
  entryType: 'debt' | 'payment' | null;
  decidedAt: string | null;
  decisionNote: string;
  cashReceivedAt: string | null;
};

export type CollectionLinkCandidate = {
  id: string;
  name: string;
  balanceUnits: number;
  sectionKey: 'customer_debts' | 'company_debts' | 'libyan_deposits' | 'egyptian_deposits';
};

export type CollectionsDashboard = {
  assignments: CollectionAssignment[];
  submissions: CollectionSubmission[];
  unlinkedReceipts: UnlinkedCollectionReceipt[];
  metrics: {
    collectedUnits: number;
    pendingCount: number;
    executedCount: number;
    cashOutstandingUnits: number;
    unlinkedPendingCount: number;
  };
  assignedCount: number;
  openBatches: Array<{ id: string; businessDate: string; batchNumber: number; openedAt: string }>;
};

export type CollectionPayrollEntry = {
  id: string;
  kind: 'withdrawal' | 'commission';
  amountUnits: number;
  reason: string;
  createdAt: string;
  createdByName: string;
  confirmedAt: string | null;
  confirmedByName: string | null;
};

export type CollectionPayrollEmployee = {
  employeeId: string;
  employeeName: string;
  username: string;
  period: string;
  baseSalaryUnits: number;
  openingCarryUnits: number;
  showOpeningCarry: boolean;
  withdrawalsUnits: number;
  commissionsUnits: number;
  remainingUnits: number;
  entries: CollectionPayrollEntry[];
};

export type CollectionPayrollDashboard = {
  period: string;
  employees: CollectionPayrollEmployee[];
};
