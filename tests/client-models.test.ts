import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CollectionAssignment, Customer, Ledger, LedgerItem } from '../src/client/api.ts';
import { assignmentTone } from '../src/client/sections/collections/useCollectionsDashboard.ts';
import {
  currencyLabel,
  orderCustomerCards,
  permissionPrefixFor,
} from '../src/client/sections/debts/debtSectionUtils.ts';
import {
  blankPurchaseDraft,
  choosePurchaseType,
  decimalInput,
  integerInput,
  purchaseDraftError,
  purchaseDraftIsBlank,
  purchaseDraftIsConsumptionOnly,
  purchaseDraftIsStandalone,
  purchaseEntryInput,
  purchaseDraftTotals,
} from '../src/client/sections/purchases/purchaseEditorModel.ts';
import {
  debtSectionFor,
  initialDashboardSection,
  visibleCustomerCards,
} from '../src/client/dashboard/dashboardModel.ts';
import {
  appendCustomerPage,
  mergeCustomerSnapshots,
  mergeFreshLedger,
  prependOlderLedgerPage,
} from '../src/client/dashboard/debtAccountState.ts';
import {
  accessLevel,
  selectedSectionAccess,
  selectedUserPermissions,
} from '../src/client/sections/settings/userAccessModel.ts';
import { treasuryCards } from '../src/client/sections/treasury/treasuryViewModel.ts';
import { auditCategory, filterAuditEntries } from '../src/client/sections/settings/auditLogModel.ts';
import { ledgerDraftResult } from '../src/client/sections/debts/ledgerModel.ts';
import {
  englishInteger as masraweyaInteger,
  masraweyaGridNavigation,
  masraweyaTotals,
} from '../src/client/sections/masraweya/masraweyaModel.ts';

function customer(id: string, balanceUnits: number, isPinned: boolean, updatedAt: string): Customer {
  return {
    id,
    name: id,
    phone: null,
    version: 1,
    activeCycleId: `${id}-cycle`,
    balanceUnits,
    currency: 'LYD',
    isPinned,
    inactiveSince: null,
    hiddenFromDefault: false,
    debtStartedAt: balanceUnits > 0 ? updatedAt : null,
    debtAgeDays: balanceUnits > 0 ? 1 : null,
    activeAssigneeName: null,
    nextSequence: 1,
    createdAt: updatedAt,
    updatedAt,
  };
}

function ledgerItem(id: string, sequence: number): LedgerItem {
  return {
    id,
    type: 'debt',
    amountUnits: 100,
    currency: 'LYD',
    paymentMode: null,
    calculationMode: 'direct',
    inputValue: 100,
    factorMicros: null,
    transactionDate: '2026-01-01T00:00:00.000Z',
    referenceNo: id,
    note: '',
    actorName: 'مدير النظام',
    actorIsOwner: true,
    sequence,
    status: 'posted',
    correctsTransactionId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function ledger(id: string, items: LedgerItem[], nextCursor: string | null = null): Ledger {
  return {
    customer: {
      id,
      name: id,
      phone: null,
      version: 1,
      openingBalanceUnits: 0,
      balanceUnits: items.length * 100,
      currency: 'LYD',
      isPinned: false,
      inactiveSince: null,
      nextSequence: items.length + 1,
    },
    items,
    pageOpeningBalanceUnits: 0,
    totalItems: items.length,
    nextCursor,
  };
}

test('customer cards keep zero balances last and order every other card by latest financial movement', () => {
  const items = [
    customer('zero', 0, true, '2026-01-04T00:00:00.000Z'),
    customer('old', 100, false, '2026-01-01T00:00:00.000Z'),
    customer('recent', 100, false, '2026-01-03T00:00:00.000Z'),
    customer('pinned', 50, true, '2026-01-02T00:00:00.000Z'),
  ];
  assert.deepEqual(
    orderCustomerCards(items).map((item) => item.id),
    ['recent', 'pinned', 'old', 'zero'],
  );
  assert.deepEqual(
    items.map((item) => item.id),
    ['zero', 'old', 'recent', 'pinned'],
  );
});

test('debt account state merges pages and realtime snapshots without duplicates', () => {
  const old = customer('old', 100, false, '2026-01-01T00:00:00.000Z');
  const changed = customer('old', 250, false, '2026-01-03T00:00:00.000Z');
  const added = customer('added', 50, true, '2026-01-02T00:00:00.000Z');
  assert.deepEqual(mergeCustomerSnapshots([old], [changed, added]).map((item) => [item.id, item.balanceUnits]), [
    ['old', 250],
    ['added', 50],
  ]);
  assert.deepEqual(appendCustomerPage([old], [changed, added]).map((item) => item.id), ['old', 'added']);
});

test('debt ledger state preserves loaded history while accepting fresh realtime rows', () => {
  const current = {
    ...ledger('customer', [ledgerItem('zero', 0), ledgerItem('one', 1), ledgerItem('two', 2)], 'older'),
    totalItems: 5,
  };
  const fresh = ledger('customer', [ledgerItem('two', 2), ledgerItem('three', 3)]);
  assert.deepEqual(mergeFreshLedger(current, fresh, 'customer')?.items.map((item) => item.id), [
    'zero', 'one', 'two', 'three',
  ]);
  const older = { ...ledger('customer', [ledgerItem('before-zero', -1)], null), totalItems: 5 };
  assert.deepEqual(prependOlderLedgerPage(current, older)?.items.map((item) => item.id), [
    'before-zero', 'zero', 'one', 'two',
  ]);
  assert.equal(prependOlderLedgerPage(current, ledger('other', [])), current);
});

test('section display rules use the shared permission and currency contracts', () => {
  assert.equal(permissionPrefixFor('customers'), 'debts');
  assert.equal(permissionPrefixFor('companies'), 'companies');
  assert.equal(permissionPrefixFor('egyptian-deposits'), 'egyptian_deposits');
  assert.equal(currencyLabel('egyptian-deposits'), 'ج.م');
  assert.equal(currencyLabel('libyan-deposits'), 'د.ل');
});

test('purchase editor accepts integer money and decimal exchange rates only', () => {
  assert.equal(integerInput('00١2a345.9'), '23459');
  assert.equal(decimalInput('5..38abc9999999'), '5.389999');
  assert.deepEqual(blankPurchaseDraft(), {
    itemCode: 'vodafone_cash',
    itemLabel: 'فودافون كاش',
    value: '',
    mode: 'divide',
    rate: '',
    paid: '',
    consumed: '',
  });
  assert.deepEqual(
    purchaseDraftTotals({
      ...blankPurchaseDraft(),
      value: '1000',
      rate: '6',
      paid: '100',
    }),
    { value: 1000, result: 167, remaining: 67 },
  );
  assert.equal(
    choosePurchaseType({ ...blankPurchaseDraft(), consumed: '200' }, 'banks', 'بنوك').consumed,
    '200',
  );
  const consumptionOnly = {
    ...blankPurchaseDraft(),
    itemCode: 'cairo',
    itemLabel: 'القاهرة',
    consumed: '750',
  };
  assert.equal(purchaseDraftIsBlank(blankPurchaseDraft()), true);
  assert.equal(purchaseDraftIsConsumptionOnly(consumptionOnly), true);
  assert.equal(purchaseDraftIsStandalone(consumptionOnly), true);
  assert.equal(purchaseDraftError(consumptionOnly), null);
  assert.deepEqual(purchaseEntryInput(consumptionOnly, 'vodafone-consumption-test', 3), {
    requestId: 'vodafone-consumption-test',
    expectedDayVersion: 3,
    itemCode: 'standalone_adjustment',
    itemLabel: 'مستهلك فودافون',
    egpValueUnits: 0,
    calculationMode: 'divide',
    exchangeRate: '1',
    paidUnits: 0,
    vodafoneConsumedUnits: 750,
  });
  const paymentOnly = { ...blankPurchaseDraft(), paid: '400' };
  assert.equal(purchaseDraftIsStandalone(paymentOnly), true);
  assert.equal(purchaseDraftError(paymentOnly), null);
  assert.deepEqual(purchaseDraftTotals(paymentOnly), { value: 0, result: 0, remaining: -400 });
  assert.deepEqual(purchaseEntryInput(paymentOnly, 'payment-only-test', 4), {
    requestId: 'payment-only-test',
    expectedDayVersion: 4,
    itemCode: 'standalone_adjustment',
    itemLabel: 'تسديد',
    egpValueUnits: 0,
    calculationMode: 'divide',
    exchangeRate: '1',
    paidUnits: 400,
    vodafoneConsumedUnits: 0,
  });
});

test('ledger draft calculations preserve direct, multiply, divide, and full-payment rules', () => {
  assert.equal(ledgerDraftResult('debt', 'direct', '1000', '', 500), 1000);
  assert.equal(ledgerDraftResult('debt', 'multiply', '1000', '1.5', 500), 1500);
  assert.equal(ledgerDraftResult('partial', 'divide', '1000', '6', 500), 166);
  assert.equal(ledgerDraftResult('full', 'direct', '', '', 500), 500);
  assert.equal(ledgerDraftResult('full', 'direct', '', '', -100), 0);
});

test('masraweya totals keep integer inputs and manual-day equations stable', () => {
  assert.equal(masraweyaInteger('00١2a345.9'), '23459');
  assert.deepEqual(
    masraweyaTotals(
      [
        { value: '1000', commission: '100' },
        { value: '500', commission: '50' },
      ],
      '2000',
      '1000',
    ),
    { workTotal: 1650, final: 1350 },
  );
  assert.deepEqual(masraweyaTotals([], '0', '0'), { workTotal: 0, final: 0 });
});

test('masraweya grid arrows move predictably and append only below the final row', () => {
  assert.deepEqual(masraweyaGridNavigation('ArrowDown', 0, 0, 4), {
    row: 1,
    column: 0,
    append: false,
  });
  assert.deepEqual(masraweyaGridNavigation('Enter', 3, 1, 4), {
    row: 4,
    column: 1,
    append: true,
  });
  assert.deepEqual(masraweyaGridNavigation('ArrowUp', 0, 0, 4), {
    row: 0,
    column: 0,
    append: false,
  });
  assert.deepEqual(masraweyaGridNavigation('ArrowLeft', 2, 0, 4), {
    row: 2,
    column: 1,
    append: false,
  });
  assert.deepEqual(masraweyaGridNavigation('ArrowRight', 2, 1, 4), {
    row: 2,
    column: 0,
    append: false,
  });
  assert.equal(masraweyaGridNavigation('Tab', 0, 0, 4), null);
});

test('collection card tones follow financial movement, payment, and admin cash review order', () => {
  const base = {
    latestSubmissionAt: '2026-01-01T10:00:00.000Z',
    externalFinancialUpdatedAt: '2026-01-01T09:00:00.000Z',
    latestCashReceivedAt: null,
    balanceUnits: 500,
    latestMode: 'partial',
  } as CollectionAssignment;
  assert.equal(assignmentTone(base), 'collection-yellow');
  assert.equal(assignmentTone({ ...base, balanceUnits: 0, latestMode: 'full' }), 'collection-green');
  assert.equal(
    assignmentTone({ ...base, externalFinancialUpdatedAt: '2026-01-01T11:00:00.000Z' }),
    'collection-base',
  );
  assert.equal(
    assignmentTone({ ...base, latestCashReceivedAt: '2026-01-01T12:00:00.000Z' }, true),
    'collection-red',
  );
});

test('dashboard restores only sections the employee can open', () => {
  const employee = {
    id: 'employee',
    username: 'employee',
    displayName: 'موظف',
    role: 'employee',
    permissions: ['collections.read'],
  };
  assert.equal(initialDashboardSection(employee, 'customers'), 'collections');
  assert.equal(initialDashboardSection(employee, 'collections'), 'collections');
  assert.equal(initialDashboardSection({ ...employee, role: 'admin' }, 'treasury'), 'treasury');
  assert.equal(debtSectionFor('settings'), 'customers');
  assert.equal(debtSectionFor('companies'), 'companies');
});

test('dashboard smart view hides inactive cards while search still finds them', () => {
  const hidden = { ...customer('hidden', 0, false, '2026-01-01T00:00:00.000Z'), hiddenFromDefault: true };
  const due = customer('due', 50, false, '2026-01-02T00:00:00.000Z');
  assert.deepEqual(
    visibleCustomerCards([hidden, due], '', 'smart').map((item) => item.id),
    ['due'],
  );
  assert.deepEqual(
    visibleCustomerCards([hidden, due], 'hidden', 'smart').map((item) => item.id),
    ['hidden'],
  );
  assert.deepEqual(
    visibleCustomerCards([hidden, due], '', 'due').map((item) => item.id),
    ['due'],
  );
  assert.deepEqual(
    visibleCustomerCards([hidden, due], '', 'today').map((item) => item.id),
    ['hidden', 'due'],
  );
});

test('employee access form derives complete section permissions from one model', () => {
  const form = new FormData();
  form.set('customerDebtsAccess', 'manage');
  form.set('collectionsAccess', 'manage');
  form.set('purchasesAccess', 'manage');
  form.set('treasuryAccess', 'unexpected');
  const permissions = selectedUserPermissions(form);
  assert.equal(accessLevel(form, 'treasuryAccess'), 'none');
  assert.deepEqual(selectedSectionAccess(form), {
    customerDebtsAccess: 'manage',
    companyDebtsAccess: 'none',
    libyanDepositsAccess: 'none',
    egyptianDepositsAccess: 'none',
    masraweyaAccess: 'none',
    purchasesAccess: 'manage',
    treasuryAccess: 'none',
    reportsAccess: 'none',
  });
  assert.deepEqual(permissions, [
    'debts.read',
    'debts.write',
    'collections.read',
    'collections.write',
    'purchases.read',
    'purchases.write',
    'purchases.finalize',
  ]);
});

test('treasury cards preserve section totals and keep active cash explicitly manual', () => {
  const cards = treasuryCards({
    currency: 'LYD',
    receivablesUnits: 900,
    liabilitiesUnits: 250,
    activeCashUnits: 100,
    egyptianSourceUnits: 540,
    egyptianConvertedUnits: 90,
    egyptianRate: 6,
    egyptianRateUpdatedAt: '2026-10-04T00:00:00.000Z',
    netUnits: 840,
    cashVersion: 3,
    sources: {
      customers: 500,
      companies: 400,
      purchases: 200,
      libyanDeposits: 50,
      egyptianDeposits: 540,
    },
  });
  assert.deepEqual(
    cards.map((card) => card.value),
    [900, 250, 100, 90, 840],
  );
  assert.equal(cards[2]?.note, 'يتغير بالدخول والخروج فقط');
  assert.equal(cards[3]?.note, '540 ج.م ÷ 6');
});

test('audit log classifies account actions and searches translated financial details', () => {
  const entries = [
    {
      id: 1,
      action: 'user.create',
      entityType: 'user',
      entityId: 'employee',
      correlationId: 'one',
      outcome: 'success' as const,
      details: {},
      actorName: 'مدير النظام',
      actorUsername: 'admin',
      createdAt: '2026-10-05T00:00:00.000Z',
    },
    {
      id: 2,
      action: 'customer.payment',
      entityType: 'customer',
      entityId: 'customer',
      correlationId: 'two',
      outcome: 'success' as const,
      details: { amountUnits: 250 },
      actorName: 'الصغير',
      actorUsername: 'alsaghir',
      createdAt: '2026-10-05T00:01:00.000Z',
    },
  ];
  assert.equal(auditCategory(entries[0]), 'accounts');
  assert.equal(auditCategory(entries[1]), 'financial');
  assert.deepEqual(
    filterAuditEntries(entries, '250', 'financial').map((entry) => entry.id),
    [2],
  );
  assert.deepEqual(
    filterAuditEntries(entries, 'إنشاء حساب', 'all').map((entry) => entry.id),
    [1],
  );
});
