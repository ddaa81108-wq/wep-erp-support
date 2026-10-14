export type Customer = {
  id: string;
  name: string;
  phone: string | null;
  version: number;
  activeCycleId: string;
  openingBalanceUnits?: number;
  balanceUnits: number;
  currency: 'LYD' | 'EGP';
  isPinned: boolean;
  inactiveSince: string | null;
  hiddenFromDefault: boolean;
  debtStartedAt: string | null;
  debtAgeDays: number | null;
  activeAssigneeName: string | null;
  systemManaged?: boolean;
  systemLinkKey?: string | null;
  nextSequence: number;
  createdAt: string;
  updatedAt?: string;
  zeroReview?: {
    pending: boolean;
    financialVersion: number;
    reviewedAt: string | null;
    reviewedByName: string | null;
  };
};

export type LedgerItem = {
  id: string;
  type: 'debt' | 'payment';
  amountUnits: number;
  currency: 'LYD' | 'EGP';
  paymentMode: 'partial' | 'full' | null;
  calculationMode: 'direct' | 'multiply' | 'divide';
  inputValue: number;
  factorMicros: number | null;
  transactionDate: string;
  referenceNo: string;
  note: string;
  displayNote?: string;
  actorName: string;
  actorIsOwner: boolean;
  sequence: number;
  status: 'posted' | 'corrected' | 'reversed';
  correctsTransactionId: string | null;
  createdAt: string;
  updatedAt?: string;
};

export type Ledger = {
  customer: Pick<
    Customer,
    | 'id'
    | 'name'
    | 'phone'
    | 'version'
    | 'openingBalanceUnits'
    | 'balanceUnits'
    | 'currency'
    | 'isPinned'
    | 'inactiveSince'
    | 'nextSequence'
    | 'systemManaged'
    | 'systemLinkKey'
  >;
  items: LedgerItem[];
  pageOpeningBalanceUnits: number;
  totalItems: number;
  nextCursor: string | null;
};

export type CustomerFilter = 'smart' | 'today' | 'due' | 'settled' | 'pinned' | 'pending-review';
export type AccountSuggestion = Pick<Customer, 'id' | 'name' | 'phone' | 'balanceUnits' | 'currency'>;
export type CustomerListOptions = {
  cursor?: string | null;
  query?: string;
  filter?: CustomerFilter;
  limit?: number;
};
export type CustomerListResult = {
  items: Customer[];
  nextCursor: string | null;
  totalItems: number;
  summary: { totalDebt: number; activeCards: number; netBalance?: number; pendingReviewCount?: number };
};
