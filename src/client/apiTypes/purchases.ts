export type PurchaseMerchantKey = 'al_bayan' | 'simsim';

export type PurchaseEntry = {
  viewTag?: string;
  id: string;
  dayId: string;
  sequence: number;
  dayNumber: number;
  businessDate: string;
  dayStatus: 'draft' | 'finalized';
  dayClosingDebtUnits: number;
  dayVersion: number;
  correctionOpen: boolean;
  itemCode: string;
  itemLabel: string;
  egpValueUnits: number;
  calculationMode: 'multiply' | 'divide';
  exchangeRate: number;
  resultUnits: number;
  paidUnits: number;
  remainingUnits: number;
  vodafoneConsumedUnits: number;
  actorName: string;
  actorIsOwner: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type PurchasesPage = {
  orderedEntryIds?:string[];
  entryDays?:Record<string,Pick<PurchaseEntry,'dayVersion'|'dayStatus'|'dayClosingDebtUnits'|'correctionOpen'>>;
  merchant: { key: PurchaseMerchantKey; name: string };
  day: {
    id: string;
    dayNumber: number;
    businessDate: string;
    status: 'draft' | 'finalized';
    previousDebtUnits: number;
    previousVodafoneUnits: number;
    todayResultUnits: number;
    todayPaidUnits: number;
    totalDebtUnits: number;
    vodafoneRemainingUnits: number;
    version: number;
    correctionOpen: boolean;
  };
  entries: PurchaseEntry[];
  nextBefore: number | null;
  registerTotals: {
    resultUnits: number;
    paidUnits: number;
    remainingUnits: number;
    vodafoneConsumedUnits: number;
    vodafoneRemainingUnits: number;
  };
};

export type PurchaseEntryInput = {
  requestId: string;
  expectedDayVersion: number;
  itemCode: string;
  itemLabel: string;
  egpValueUnits: number;
  calculationMode: 'multiply' | 'divide';
  exchangeRate: string;
  paidUnits: number;
  vodafoneConsumedUnits: number;
};
