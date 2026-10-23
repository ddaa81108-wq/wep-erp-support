import type { AppDatabase } from '../db/database.ts';
import { SCHEMA_VERSION } from '../config.ts';

type Row = Record<string, unknown>;
export type FinancialIssue = {
  code: string;
  organizationId: string | null;
  entityId: string;
  field: string;
  expected: string;
  actual: string;
  differenceUnits?: string;
};
const units = (value: unknown) => {
  if (typeof value !== 'bigint') throw new Error('Reconciliation requires exact SQLite integers.');
  return value;
};
const text = (value: unknown) => String(value ?? '');
const sections = {
  customer_debts: 'LYD',
  company_debts: 'LYD',
  libyan_deposits: 'LYD',
  egyptian_deposits: 'EGP',
} as const;

function adjustmentExplained(original: Row, current: Row, customerId: string, audits: Row[]) {
  const initialAmount = original.amountUnits;
  if (typeof initialAmount !== 'number' || !Number.isSafeInteger(initialAmount)) return false;
  let amount = initialAmount,
    type = original.type,
    status = 'posted';
  for (const audit of audits) {
    const details = JSON.parse(text(audit.details_json)) as {
      customerId?: unknown;
      previous?: { type?: unknown; amountUnits?: unknown };
      next?: { type?: unknown; amountUnits?: unknown };
    };
    if (details.customerId !== customerId || status !== 'posted') return false;
    if (text(audit.action).endsWith('.update')) {
      if (details.previous?.type !== type || details.previous?.amountUnits !== amount) return false;
      const next = details.next;
      if (
        !next ||
        !['payment', 'debt'].includes(text(next.type)) ||
        typeof next.amountUnits !== 'number' ||
        !Number.isSafeInteger(next.amountUnits) ||
        next.amountUnits <= 0
      )
        return false;
      type = next.type;
      amount = next.amountUnits;
    } else status = 'reversed';
  }
  return (
    audits.length > 0 &&
    current.deleted_at === null &&
    current.entry_type === type &&
    units(current.amount_units) === BigInt(amount) &&
    current.transaction_status === status
  );
}

/** Independent, read-only reconstruction. No domain query that creates or repairs data is called. */
export function reconcileFinancials(db: AppDatabase) {
  if (db.isTransaction)
    throw new Error('Run reconciliation on a separate connection outside a write transaction.');
  const snapshotStartedAt = new Date().toISOString();
  db.exec('BEGIN');
  try {
    const read = (sql: string, ...params: string[]) => {
      const statement = db.prepare(sql);
      statement.setReadBigInts(true);
      return statement.all(...params) as Row[];
    };
    const schema = units(read('SELECT COALESCE(MAX(version),0) version FROM schema_migrations')[0].version);
    if (schema < 50n || schema > BigInt(SCHEMA_VERSION))
      throw new Error(`Unsupported financial schema: ${schema}`);
    const issues: FinancialIssue[] = [];
    const warnings: Array<{ code: string; organizationId: string; entityId?: string }> = [];
    let issueCount = 0,
      warningCount = 0,
      checks = 0;
    const warn = (item: (typeof warnings)[number]) => {
      warningCount++;
      if (warnings.length < 200) warnings.push(item);
    };
    const issue = (item: FinancialIssue) => {
      issueCount++;
      if (issues.length < 200) issues.push(item);
    };
    const compare = (org: string, id: string, field: string, expected: bigint, actual: unknown) => {
      checks++;
      const stored = units(actual);
      if (expected !== stored)
        issue({
          code: 'AMOUNT_MISMATCH',
          organizationId: org,
          entityId: id,
          field,
          expected: String(expected),
          actual: String(stored),
          differenceUnits: String(stored - expected),
        });
      if (expected > BigInt(Number.MAX_SAFE_INTEGER) || expected < -BigInt(Number.MAX_SAFE_INTEGER))
        issue({
          code: 'UNSAFE_DISPLAY_AMOUNT',
          organizationId: org,
          entityId: id,
          field,
          expected: 'safe whole integer',
          actual: String(expected),
        });
    };
    const structural = (org: string, id: string, field: string, expected: string, actual: unknown) => {
      checks++;
      if (text(actual) !== expected)
        issue({
          code: 'REFERENCE_MISMATCH',
          organizationId: org,
          entityId: id,
          field,
          expected,
          actual: text(actual),
        });
    };
    for (const row of read('PRAGMA foreign_key_check'))
      issue({
        code: 'FOREIGN_KEY_MISMATCH',
        organizationId: null,
        entityId: text(row.rowid),
        field: text(row.table),
        expected: text(row.parent),
        actual: 'missing parent',
      });
    const integrity = read('PRAGMA quick_check');
    for (const row of integrity)
      if (Object.values(row)[0] !== 'ok')
        issue({
          code: 'SQLITE_INTEGRITY_ERROR',
          organizationId: null,
          entityId: 'database',
          field: 'quick_check',
          expected: 'ok',
          actual: text(Object.values(row)[0]),
        });

    const organizations = read('SELECT id FROM organizations ORDER BY id').map((organization) => {
      const org = text(organization.id);
      const latestPurchases = new Map<string, { debt: bigint; vodafone: bigint }>();
      const dayTotals = new Map<
        string,
        { result: bigint; paid: bigint; vodafone: bigint; consumed: bigint }
      >();
      let purchaseEntryCount = 0;
      for (const entry of read(
        'SELECT * FROM purchase_entries WHERE organization_id=? AND deleted_at IS NULL',
        org,
      )) {
        const value = units(entry.egp_value_units),
          rate = units(entry.exchange_rate_micros);
        const numerator = entry.calculation_mode === 'multiply' ? value * rate : value * 1_000_000n;
        const denominator = entry.calculation_mode === 'multiply' ? 1_000_000n : rate;
        const result = (numerator + denominator / 2n) / denominator;
        compare(org, text(entry.id), 'purchase.result_units', result, entry.result_units);
        compare(
          org,
          text(entry.id),
          'purchase.remaining_units',
          result - units(entry.paid_units),
          entry.remaining_units,
        );
        const totals = dayTotals.get(text(entry.day_id)) ?? {
          result: 0n,
          paid: 0n,
          vodafone: 0n,
          consumed: 0n,
        };
        totals.result += result;
        totals.paid += units(entry.paid_units);
        if (entry.item_code === 'vodafone_cash') totals.vodafone += value;
        totals.consumed += units(entry.vodafone_consumed_units);
        dayTotals.set(text(entry.day_id), totals);
        purchaseEntryCount++;
      }
      const purchaseDays = read(
        'SELECT * FROM purchase_days WHERE organization_id=? ORDER BY merchant_id,day_number',
        org,
      );
      for (const day of purchaseDays) {
        const merchant = text(day.merchant_id),
          previous = latestPurchases.get(merchant);
        const totals = dayTotals.get(text(day.id)) ?? { result: 0n, paid: 0n, vodafone: 0n, consumed: 0n };
        // The first opening is an explicit business input, not assumed to be zero.
        const openingDebt = previous?.debt ?? units(day.previous_debt_units);
        const openingVodafone = previous?.vodafone ?? units(day.previous_vodafone_units);
        const debt = openingDebt + totals.result - totals.paid,
          vodafone = openingVodafone + totals.vodafone - totals.consumed;
        for (const [field, value] of Object.entries({
          previous_debt_units: openingDebt,
          previous_vodafone_units: openingVodafone,
          today_result_units: totals.result,
          today_paid_units: totals.paid,
          today_vodafone_value_units: totals.vodafone,
          today_vodafone_consumed_units: totals.consumed,
          total_debt_units: debt,
          vodafone_remaining_units: vodafone,
        }))
          compare(org, text(day.id), `purchase_day.${field}`, value, day[field]);
        latestPurchases.set(merchant, { debt, vodafone });
      }
      let purchaseDebt = 0n,
        vodafone = 0n;
      for (const latest of latestPurchases.values()) {
        purchaseDebt += latest.debt;
        vodafone += latest.vodafone;
      }
      const masraweyaWork = new Map<string, bigint>();
      for (const entry of read(
        'SELECT e.* FROM masraweya_entries e JOIN masraweya_days d ON d.id=e.day_id WHERE d.organization_id=?',
        org,
      ))
        masraweyaWork.set(
          text(entry.day_id),
          (masraweyaWork.get(text(entry.day_id)) ?? 0n) +
            units(entry.value_units) +
            units(entry.commission_units),
        );
      let masraweyaClosing = 0n;
      const masraweyaDays = read(
        'SELECT * FROM masraweya_days WHERE organization_id=? ORDER BY business_date',
        org,
      );
      for (const day of masraweyaDays) {
        const opening = masraweyaClosing + units(day.carry_adjustment_units);
        compare(org, text(day.id), 'masraweya.previous_value_units', opening, day.previous_value_units);
        masraweyaClosing = opening + units(day.purchases_units) - (masraweyaWork.get(text(day.id)) ?? 0n);
      }
      const linked = new Map([
        ['masraweya_remainder', masraweyaClosing],
        ['purchases_vodafone_remainder', vodafone],
      ]);
      const balances = new Map<string, bigint>();
      const storedBalances = new Map<string, bigint>();
      const debts = new Map<string, bigint>();
      const credits = new Map<string, bigint>();
      const customers = read('SELECT * FROM customers WHERE organization_id=? AND deleted_at IS NULL', org);
      const cycles = read(
        'SELECT cy.* FROM customer_cycles cy JOIN customers c ON c.id=cy.customer_id WHERE c.organization_id=? AND c.deleted_at IS NULL',
        org,
      );
      const cycleMap = new Map<string, Row>(),
        cycleOwners = new Map<string, string>();
      for (const cycle of cycles) {
        cycleOwners.set(text(cycle.id), text(cycle.customer_id));
        if (cycle.status === 'active') {
          if (cycleMap.has(text(cycle.customer_id)))
            structural(org, text(cycle.customer_id), 'active_cycle_count', 'one', 'multiple');
          cycleMap.set(text(cycle.customer_id), cycle);
        }
      }
      const ledger = new Map<string, bigint>();
      let ledgerEntryCount = 0;
      for (const entry of read(
        `SELECT t.* FROM debt_transactions t JOIN customers c ON c.id=t.customer_id
        WHERE c.organization_id=? AND c.deleted_at IS NULL AND t.deleted_at IS NULL AND t.transaction_status='posted'`,
        org,
      )) {
        const input = units(entry.input_value_micros);
        const calculated =
          entry.calculation_mode === 'direct'
            ? input / 1_000_000n
            : entry.calculation_mode === 'multiply'
              ? (input * units(entry.calculation_factor_micros)) / 1_000_000_000_000n
              : input / units(entry.calculation_factor_micros);
        compare(org, text(entry.id), 'ledger.calculated_amount_units', calculated, entry.amount_units);
        const effect = (units(entry.amount_units) * units(entry.conversion_rate_micros)) / 1_000_000n;
        structural(
          org,
          text(entry.id),
          'ledger.cycle_owner',
          text(entry.customer_id),
          cycleOwners.get(text(entry.cycle_id)),
        );
        ledger.set(
          text(entry.cycle_id),
          (ledger.get(text(entry.cycle_id)) ?? 0n) + (entry.entry_type === 'debt' ? effect : -effect),
        );
        ledgerEntryCount++;
      }
      const foundLinks = new Set<string>();
      for (const customer of customers) {
        const id = text(customer.id),
          section = text(customer.section_key),
          link = text(customer.system_link_key);
        storedBalances.set(
          section,
          (storedBalances.get(section) ?? 0n) + units(customer.current_balance_units),
        );
        const cycle = cycleMap.get(id);
        if (!cycle) {
          structural(org, id, 'active_cycle', 'present', 'missing');
          continue;
        }
        let balance: bigint;
        if (link) {
          const source = linked.get(link);
          if (source === undefined) {
            structural(org, id, 'system_link_key', 'known source', link);
            continue;
          }
          foundLinks.add(link);
          balance = source;
          structural(org, id, 'linked.section_key', 'egyptian_deposits', section);
        } else balance = units(cycle.initial_balance_units) + (ledger.get(text(cycle.id)) ?? 0n);
        if (!(section in sections)) {
          structural(org, id, 'section_key', 'known financial section', section);
          continue;
        }
        structural(org, id, 'cycle.currency', sections[section as keyof typeof sections], cycle.currency);
        compare(org, id, 'customer.current_balance_units', balance, customer.current_balance_units);
        balances.set(section, (balances.get(section) ?? 0n) + balance);
        debts.set(section, (debts.get(section) ?? 0n) + (balance > 0n ? balance : 0n));
        credits.set(section, (credits.get(section) ?? 0n) + (balance < 0n ? -balance : 0n));
      }
      for (const [key, balance] of linked)
        if (balance !== 0n && !foundLinks.has(key))
          structural(org, key, 'linked_account', 'present', 'missing');
      for (const section of Object.keys(sections)) {
        compare(
          org,
          section,
          'section.net_units',
          balances.get(section) ?? 0n,
          storedBalances.get(section) ?? 0n,
        );
        compare(
          org,
          section,
          'section.debt_units.safe_range',
          debts.get(section) ?? 0n,
          debts.get(section) ?? 0n,
        );
        compare(
          org,
          section,
          'section.credit_units.safe_range',
          credits.get(section) ?? 0n,
          credits.get(section) ?? 0n,
        );
      }
      compare(org, org, 'purchases.total.safe_range', purchaseDebt, purchaseDebt);
      compare(org, org, 'masraweya.closing.safe_range', masraweyaClosing, masraweyaClosing);

      let cash = 0n,
        sequence = 1n,
        cashEntryCount = 0;
      for (const entry of read(
        'SELECT * FROM treasury_cash_entries WHERE organization_id=? ORDER BY sequence',
        org,
      )) {
        compare(org, text(entry.id), 'cash.sequence', sequence, entry.sequence);
        compare(org, text(entry.id), 'cash.balance_before_units', cash, entry.balance_before_units);
        cash += (entry.direction === 'in' ? 1n : -1n) * units(entry.amount_units);
        compare(org, text(entry.id), 'cash.balance_after_units', cash, entry.balance_after_units);
        sequence++;
        cashEntryCount++;
      }
      const cashAccount = read('SELECT * FROM treasury_cash_accounts WHERE organization_id=?', org)[0];
      if (cashAccount) {
        compare(org, org, 'cash.balance_units', cash, cashAccount.balance_units);
        compare(org, org, 'cash.next_sequence', sequence, cashAccount.next_sequence);
      } else if (cashEntryCount) structural(org, org, 'cash_account', 'present', 'missing');

      // Receipt comparisons use the original posting acknowledgement. Later audited
      // edits/cancellations and day cleanup must not be mistaken for another payment.
      const postings = new Map<string, { transaction: Row; customerId: string }>();
      for (const row of read(
        `SELECT k.* FROM idempotency_keys k JOIN users u ON u.id=k.actor_user_id
        WHERE u.organization_id=? AND k.scope LIKE '%:transactions:create' AND (k.request_id LIKE 'collection-%' OR k.request_id LIKE 'unlinked-collection-%')`,
        org,
      )) {
        const body = JSON.parse(text(row.response_json)) as Row;
        const transaction = body.transaction;
        if (transaction && typeof transaction === 'object')
          postings.set(text(row.request_id), {
            transaction: transaction as Row,
            customerId: text(row.scope).match(/^[^:]+:(.+):transactions:create$/)?.[1] ?? '',
          });
      }
      const hasReceiptCurrency = read('PRAGMA table_info(collection_unlinked_receipts)').some(
        (column) => column.name === 'currency',
      );
      const approved = read(
        `SELECT s.id,s.customer_id,s.amount_units,s.approved_transaction_id,'payment' entry_type,'collection-' prefix,'LYD' currency
        FROM collection_submissions s JOIN customers c ON c.id=s.customer_id WHERE c.organization_id=? AND s.status='approved'
        UNION ALL SELECT id,linked_customer_id,amount_units,approved_transaction_id,entry_type,'unlinked-collection-' prefix,${hasReceiptCurrency ? 'currency' : 'NULL'} currency
        FROM collection_unlinked_receipts WHERE organization_id=? AND status='approved'`,
        org,
        org,
      );
      const seenTransactions = new Set<string>();
      for (const receipt of approved) {
        const id = text(receipt.id),
          posting = postings.get(text(receipt.prefix) + id);
        if (!posting) {
          warn({ code: 'RECEIPT_ORIGINAL_POSTING_UNAVAILABLE', organizationId: org, entityId: id });
          continue;
        }
        const original = posting.transaction;
        structural(org, id, 'receipt.transaction_id', text(receipt.approved_transaction_id), original.id);
        structural(org, id, 'receipt.type', text(receipt.entry_type), original.type);
        if (receipt.currency !== null)
          structural(org, id, 'receipt.currency', text(receipt.currency), original.currency);
        else warn({ code: 'RECEIPT_CURRENCY_UNAVAILABLE', organizationId: org, entityId: id });
        structural(org, id, 'receipt.customer', text(receipt.customer_id), posting.customerId);
        const originalAmount = original.amountUnits;
        if (typeof originalAmount === 'number' && Number.isSafeInteger(originalAmount))
          compare(org, id, 'receipt.amount_units', BigInt(originalAmount), receipt.amount_units);
        else warn({ code: 'RECEIPT_ORIGINAL_AMOUNT_UNAVAILABLE', organizationId: org, entityId: id });
        if (seenTransactions.has(text(receipt.approved_transaction_id)))
          structural(org, id, 'receipt.unique_transaction', 'one receipt', 'multiple receipts');
        seenTransactions.add(text(receipt.approved_transaction_id));
      }
      let archivedPostings = 0,
        adjustedPostings = 0;
      for (const [key, posting] of postings) {
        const original = posting.transaction,
          id = text(original.id);
        const current = read(
          'SELECT t.*,c.organization_id FROM debt_transactions t JOIN customers c ON c.id=t.customer_id WHERE t.id=?',
          id,
        )[0];
        if (!current) {
          structural(org, id, 'collection_posting', 'present', 'missing');
          continue;
        }
        structural(org, id, 'collection_posting.organization', org, current.organization_id);
        structural(org, id, 'collection_posting.customer', posting.customerId, current.customer_id);
        structural(org, id, 'collection_posting.currency', text(original.currency), current.currency);
        const unlinked = key.startsWith('unlinked-collection-');
        if (unlinked && original.currency !== 'LYD')
          warn({ code: 'UNLINKED_COLLECTION_CURRENCY_POLICY_REVIEW', organizationId: org, entityId: id });
        const receiptId = key.slice(unlinked ? 'unlinked-collection-'.length : 'collection-'.length);
        const approval = read(
          'SELECT details_json FROM audit_log WHERE organization_id=? AND action=? AND entity_id=? ORDER BY id LIMIT 1',
          org,
          unlinked ? 'collection.unlinked.approve' : 'collection.approve',
          receiptId,
        )[0];
        if (approval)
          structural(
            org,
            id,
            'collection_posting.approval_audit',
            id,
            (JSON.parse(text(approval.details_json)) as Row).transactionId,
          );
        else warn({ code: 'COLLECTION_APPROVAL_EVIDENCE_UNAVAILABLE', organizationId: org, entityId: id });
        if (!approved.some((receipt) => text(receipt.prefix) + text(receipt.id) === key)) archivedPostings++;
        if (
          typeof original.amountUnits === 'number' &&
          Number.isSafeInteger(original.amountUnits) &&
          (units(current.amount_units) !== BigInt(original.amountUnits) ||
            current.entry_type !== original.type ||
            current.transaction_status !== 'posted' ||
            current.deleted_at !== null)
        ) {
          adjustedPostings++;
          const changes = read(
            `SELECT action,details_json FROM audit_log WHERE organization_id=? AND entity_type='debt_transaction' AND entity_id=?
            AND action IN ('customer.transaction.update','customer.transaction.cancel','company.transaction.update','company.transaction.cancel','libyan_deposit.transaction.update','libyan_deposit.transaction.cancel','egyptian_deposit.transaction.update','egyptian_deposit.transaction.cancel') ORDER BY id`,
            org,
            id,
          );
          if (!adjustmentExplained(original, current, posting.customerId, changes))
            warn({ code: 'COLLECTION_POSTING_CHANGED_REVIEW_AUDIT', organizationId: org, entityId: id });
        }
      }
      const egp = balances.get('egyptian_deposits') ?? 0n;
      const rate = read(
        "SELECT source_units_per_target_micros FROM section_exchange_rates WHERE organization_id=? AND section_key='egyptian_deposits'",
        org,
      )[0];
      let converted: bigint | null = egp === 0n ? 0n : null;
      if (rate) {
        const divisor = units(rate.source_units_per_target_micros),
          n = egp * 1_000_000n;
        converted = (n + (n >= 0n ? divisor / 2n : -divisor / 2n)) / divisor;
      } else if (egp !== 0n) warn({ code: 'EGP_CONVERSION_RATE_MISSING', organizationId: org });
      const net =
        converted === null
          ? null
          : (balances.get('customer_debts') ?? 0n) +
            (balances.get('company_debts') ?? 0n) +
            cash +
            converted -
            purchaseDebt -
            (balances.get('libyan_deposits') ?? 0n);
      if (converted !== null) compare(org, org, 'egyptian.converted.safe_range', converted, converted);
      if (net !== null) compare(org, org, 'treasury.net.safe_range', net, net);
      return {
        organizationId: org,
        counts: {
          accounts: customers.length,
          ledgerEntries: ledgerEntryCount,
          purchaseEntries: purchaseEntryCount,
          purchaseDays: purchaseDays.length,
          masraweyaDays: masraweyaDays.length,
          cashEntries: cashEntryCount,
          approvedReceipts: approved.length,
          archivedCollectionPostings: archivedPostings,
          adjustedCollectionPostings: adjustedPostings,
        },
        sections: Object.entries(sections).map(([section, currency]) => ({
          section,
          currency,
          expectedNetUnits: String(balances.get(section) ?? 0n),
          storedNetUnits: String(storedBalances.get(section) ?? 0n),
          differenceUnits: String((storedBalances.get(section) ?? 0n) - (balances.get(section) ?? 0n)),
          expectedDebtUnits: String(debts.get(section) ?? 0n),
          expectedCreditUnits: String(credits.get(section) ?? 0n),
        })),
        purchasesDebtLyd: String(purchaseDebt),
        vodafoneRemainderEgp: String(vodafone),
        activeCashLyd: String(cash),
        egyptianConvertedLyd: converted === null ? null : String(converted),
        expectedTreasuryNetLyd: net === null ? null : String(net),
      };
    });
    const result = {
      reportVersion: 1,
      snapshotStartedAt,
      checkedAt: new Date().toISOString(),
      schemaVersion: String(schema),
      status: issueCount ? 'mismatch' : warningCount ? 'needs_review' : 'matched',
      checks,
      issueCount,
      issues,
      issuesTruncated: issueCount > issues.length,
      warningCount,
      warnings,
      warningsTruncated: warningCount > warnings.length,
      organizations,
      scope: [
        'active account balances and section summaries',
        'system-linked EGP accounts from their sources',
        'purchase calculations and day carry',
        'Masraweya carry with historical adjustments',
        'independent active cash ledger',
        'original collection postings including closed days',
      ],
      limitations: [
        'Opening balances and approved exchange rates are business inputs, not independently certified.',
        'Missing original receipt evidence or later changes require review; no repair is performed.',
        'Historical report snapshots and payroll are outside this check.',
        'Approved collections are not equated with independent active cash.',
        'Money values are exact decimal strings; currencies are not added without an approved rate.',
      ],
    };
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
