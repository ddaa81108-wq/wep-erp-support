import assert from 'node:assert/strict';
import { test } from 'node:test';
import { positiveRateMicros } from '../src/shared/moneyCalculation.ts';
import { calculateCustomerAmount } from '../src/server/domain/customerMoney.ts';
import { ledgerDraftResult, ledgerFactor } from '../src/client/sections/debts/ledgerModel.ts';
import {
  blankPurchaseDraft,
  purchaseDraftTotals,
} from '../src/client/sections/purchases/purchaseEditorModel.ts';
import { exchangeRateMicros, roundedResult } from '../src/server/domain/purchaseSupport.ts';
import { openDatabase } from '../src/server/db/database.ts';
import { createCustomer } from '../src/server/domain/customerAccountCommands.ts';
import {
  addCustomerTransaction,
  correctCustomerTransaction,
} from '../src/server/domain/customerTransactions.ts';
import { setEgyptianDepositRate } from '../src/server/modules/treasury/exchangeRates.ts';
import type { AuthenticatedUser } from '../src/server/security/sessions.ts';

test('decimal factors produce exact whole ledger results on both client and server', () => {
  for (const [value, factor, mode, expected] of [
    [150, '5.30', 'divide', 28],
    [100, '0.29', 'multiply', 29],
    [29, '0.29', 'divide', 100],
    [150, '5.30', 'multiply', 795],
    [1000000, '0.000001', 'multiply', 1],
    [10, '3', 'divide', 3],
  ] as const) {
    const saved = calculateCustomerAmount(value, mode, factor);
    assert.equal(saved.amountUnits, expected);
    assert.equal(saved.factorMicros, positiveRateMicros(factor));
    assert.equal(ledgerDraftResult('debt', mode, String(value), factor, 0), expected);
  }
  assert.match(ledgerFactor.format(5.3), /^5[,.]3$/);
  for (const value of [1.5, 150.25, Infinity, NaN]) {
    assert.throws(() => calculateCustomerAmount(value, 'divide', '5.3'), { code: 'INVALID_AMOUNT' });
    assert.equal(ledgerDraftResult('debt', 'divide', String(value), '5.3', 0), 0);
  }
  for (const factor of [0, -1, '', null, true, [], '0.0000001', '1.2345678', 'NaN', 'Infinity']) {
    assert.throws(() => calculateCustomerAmount(150, 'divide', factor), {
      code: 'INVALID_CALCULATION_FACTOR',
    });
  }
  assert.throws(() => calculateCustomerAmount(1, 'divide', '5.3'), { code: 'INVALID_CALCULATION_RESULT' });
  assert.throws(() => calculateCustomerAmount(9000000000, 'multiply', '9000000000'), {
    code: 'INVALID_CALCULATION_RESULT',
  });
});

test('purchase previews match existing exact nearest-integer server rounding', () => {
  for (const mode of ['multiply', 'divide'] as const) {
    for (const rate of ['5.3', '1.005', '0.29', '6', '0.000001']) {
      const result = roundedResult(100, exchangeRateMicros(rate), mode).result;
      const preview = purchaseDraftTotals({ ...blankPurchaseDraft(), value: '100', rate, mode, paid: '2' });
      assert.equal(preview.result, result);
      assert.equal(preview.remaining, result - 2);
      assert.ok(Number.isSafeInteger(preview.result));
    }
  }
});

test('all four account sections persist decimal factors with whole balances and reject fractional money', () => {
  const db = openDatabase(':memory:');
  const at = new Date().toISOString();
  db.prepare(
    'INSERT INTO users(id,username,display_name,password_hash,role,organization_id,home_branch_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
  ).run(
    'factor-admin',
    'factor-admin',
    'Factor Admin',
    'test-only',
    'admin',
    'org-default',
    'branch-main',
    at,
    at,
  );
  const actor: AuthenticatedUser = {
    id: 'factor-admin',
    username: 'factor-admin',
    displayName: 'Factor Admin',
    role: 'admin',
    organizationId: 'org-default',
    homeBranchId: 'branch-main',
    mustChangePassword: false,
    permissions: new Set(),
    sessionTokenHash: 'test',
    csrfHash: 'test',
  };
  try {
    for (const kind of ['customer', 'company', 'depositLyd', 'depositEgp'] as const) {
      const created = createCustomer(
        db,
        actor,
        { name: 'Factor ' + kind, openingBalance: 150, requestId: 'factor-create-' + kind },
        'test',
        kind,
      );
      const customer = created.body.customer as { id: string };
      const result = addCustomerTransaction(
        db,
        actor,
        customer.id,
        {
          requestId: 'factor-payment-' + kind,
          expectedVersion: 1,
          type: 'payment',
          inputValue: 150,
          calculationMode: 'divide',
          factor: 5.3,
        },
        'test',
        kind,
      );
      assert.equal(result.body.balanceUnits, 122);
      const transaction = result.body.transaction as { amountUnits: number; factorMicros: number };
      assert.equal(transaction.amountUnits, 28);
      assert.equal(transaction.factorMicros, 5300000);
      const opening = db
        .prepare('SELECT id FROM debt_transactions WHERE customer_id=? AND customer_sequence=1')
        .get(customer.id) as { id: string };
      const correction = correctCustomerTransaction(
        db,
        actor,
        customer.id,
        opening.id,
        {
          requestId: 'factor-correct-' + kind,
          expectedVersion: 2,
          type: 'debt',
          inputValue: 150,
          calculationMode: 'divide',
          factor: 5.3,
        },
        'test',
        kind,
      );
      assert.equal(correction.body.balanceUnits, 0);
      assert.throws(
        () =>
          addCustomerTransaction(
            db,
            actor,
            customer.id,
            {
              requestId: 'fraction-reject-' + kind,
              expectedVersion: 3,
              type: 'debt',
              inputValue: 1.5,
              calculationMode: 'direct',
            },
            'test',
            kind,
          ),
        { code: 'INVALID_AMOUNT' },
      );
    }
    assert.equal(setEgyptianDepositRate(db, actor, '5.3').egpPerLyd, 5.3);
    for (const rate of ['0.0000001', '1.1234567', 0, -1])
      assert.throws(() => setEgyptianDepositRate(db, actor, rate), { code: 'INVALID_EXCHANGE_RATE' });
  } finally {
    db.close();
  }
});
