import { zeroReviewSnapshot } from './customerZeroReview.ts';
import { businessDayRange, organizationBusinessDate, organizationTimezone } from './reports/businessDates.ts';
import type { AppDatabase } from '../db/database.ts';
import { badRequest, notFound } from '../http/errors.ts';
import { pageLimit } from './pagination.ts';
import { partyProfile, type DebtPartyKind } from './customerProfiles.ts';
import { customerAccount, customerBalance } from './customerAccountRepository.ts';

function normalizeSearch(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('ar')
    .replace(/[\u064B-\u065F\u0670]/g, '').replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim();
}

type FeedCursor = { zeroRank: number; updatedAt: string; id: string };
function decodeFeedCursor(value: string | null): FeedCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<FeedCursor>;
    if ((parsed.zeroRank !== 0 && parsed.zeroRank !== 1)
      || typeof parsed.updatedAt !== 'string' || typeof parsed.id !== 'string') return null;
    return parsed as FeedCursor;
  } catch { return null; }
}

export function listCustomers(
  database: AppDatabase,
  url: URL,
  organizationId: string,
  kind: DebtPartyKind = 'customer',
) {
  const profile = partyProfile(kind);
  const limit = pageLimit(url.searchParams.get('limit'), 100);
  const cursor = decodeFeedCursor(url.searchParams.get('cursor'));
  const search = normalizeSearch(url.searchParams.get('q') ?? '');
  const filter = url.searchParams.get('filter') ?? 'all';
  const zeroRank = "CASE WHEN c.current_balance_units=0 AND (c.section_key<>'customer_debts' OR c.zero_review_pending=0) THEN 1 ELSE 0 END";
  const conditions = ['c.organization_id = ?', 'c.section_key = ?', 'c.deleted_at IS NULL'];
  const parameters: Array<string | number> = [organizationId, profile.sectionKey];
  if (filter === 'pending-review') conditions.push("c.section_key='customer_debts' AND c.current_balance_units=0 AND c.zero_review_pending=1");
  if (search) {
    conditions.push('(c.normalized_name LIKE ? OR c.phone LIKE ?)');
    parameters.push(`%${search}%`, `%${search}%`);
  } else if (filter === 'due') conditions.push('c.current_balance_units > 0');
  else if (filter === 'today') conditions.push('c.financial_updated_at >= ? AND c.financial_updated_at < ?');
  else if (filter === 'settled') conditions.push('c.current_balance_units = 0');
  else if (filter === 'pinned') conditions.push('c.is_pinned = 1');
  else if (filter === 'smart') {
    conditions.push(`NOT (
      c.current_balance_units = 0 AND (c.section_key <> 'customer_debts' OR c.zero_review_pending=0) AND c.is_pinned = 0 AND c.inactive_since IS NOT NULL
      AND c.inactive_since <= ?
    )`);
    parameters.push(new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString());
  }
  if (!search && filter === 'today') {
    const range = businessDayRange(organizationBusinessDate(database, organizationId), organizationTimezone(database, organizationId));
    parameters.push(range.start, range.end);
  }
  const countWhere = conditions.join(' AND ');
  const pageConditions = [...conditions];
  const pageParameters = [...parameters];
  if (cursor) {
    pageConditions.push(`(
      (${zeroRank}) > ?
      OR ((${zeroRank}) = ? AND c.financial_updated_at < ?)
      OR ((${zeroRank}) = ? AND c.financial_updated_at = ? AND c.id < ?)
    )`);
    pageParameters.push(
      cursor.zeroRank,
      cursor.zeroRank, cursor.updatedAt,
      cursor.zeroRank, cursor.updatedAt, cursor.id,
    );
  }
  const pageWhere = pageConditions.join(' AND ');
  const rows = database.prepare(`
    SELECT c.*, cy.id AS cycle_id, cy.initial_balance_units,
      ${zeroRank} AS zero_rank,
      (SELECT u.display_name
        FROM debt_assignments a JOIN users u ON u.id = a.assignee_user_id
        WHERE a.customer_id = c.id AND a.status = 'active'
        LIMIT 1) AS active_assignee_name
    FROM customers c
    JOIN customer_cycles cy ON cy.customer_id = c.id AND cy.status = 'active'
    WHERE ${pageWhere}
    ORDER BY ${zeroRank} ASC, c.financial_updated_at DESC, c.id DESC
    LIMIT ?
  `).all(...pageParameters, limit + 1) as Record<string, unknown>[];
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const totalItems = Number((database.prepare(`
    SELECT COUNT(*) AS count FROM customers c WHERE ${countWhere}
  `).get(...parameters) as { count: number }).count);
  const summary = database.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN current_balance_units > 0 THEN current_balance_units ELSE 0 END), 0) AS total_debt,
      COALESCE(SUM(current_balance_units), 0) AS net_balance,
      COALESCE(SUM(CASE WHEN current_balance_units <> 0 THEN 1 ELSE 0 END), 0) AS active_cards,
      COALESCE(SUM(CASE WHEN current_balance_units=0 AND zero_review_pending=1 THEN 1 ELSE 0 END),0) AS pending_review_count
    FROM customers WHERE organization_id = ? AND section_key = ? AND deleted_at IS NULL
  `).get(
    organizationId,
    profile.sectionKey,
  ) as { total_debt: number; active_cards: number; net_balance: number; pending_review_count: number };
  const hideBefore = Date.now() - 30 * 24 * 60 * 60_000;
  return {
    items: pageRows.map((row) => {
      const balanceUnits = Number(row.current_balance_units);
      const inactiveSince = row.inactive_since ? String(row.inactive_since) : null;
      const isPinned = Number(row.is_pinned) === 1;
      const debtStartedAt = row.debt_started_at ? String(row.debt_started_at) : null;
      const debtAgeDays = debtStartedAt && balanceUnits > 0
        ? Math.max(0, Math.floor((Date.now() - new Date(debtStartedAt).getTime()) / (24 * 60 * 60_000)))
        : null;
      return {
        id: String(row.id),
        name: String(row.name),
        phone: row.phone ? String(row.phone) : null,
        version: Number(row.version),
        activeCycleId: String(row.cycle_id),
        openingBalanceUnits: Number(row.initial_balance_units),
        balanceUnits,
        currency: profile.currency,
        isPinned,
        inactiveSince,
        zeroReview: zeroReviewSnapshot(row),
        hiddenFromDefault: balanceUnits === 0 && !isPinned && !zeroReviewSnapshot(row)?.pending
          && inactiveSince !== null && new Date(inactiveSince).getTime() <= hideBefore,
        debtStartedAt,
        debtAgeDays,
        activeAssigneeName: row.active_assignee_name ? String(row.active_assignee_name) : null,
        systemManaged: Boolean(row.system_link_key),
        systemLinkKey: row.system_link_key ? String(row.system_link_key) : null,
        nextSequence: Number(row.ledger_next_sequence),
        createdAt: String(row.created_at),
        updatedAt: String(row.financial_updated_at ?? row.updated_at),
      };
    }),
    nextCursor: hasMore ? (() => {
      const last = pageRows.at(-1)!;
      return Buffer.from(JSON.stringify({
        zeroRank: Number(last.zero_rank),
        updatedAt: String(last.financial_updated_at), id: String(last.id),
      } satisfies FeedCursor)).toString('base64url');
    })() : null,
    totalItems,
    summary: { netBalance: Number(summary.net_balance), totalDebt: Number(summary.total_debt), activeCards: Number(summary.active_cards), pendingReviewCount: Number(summary.pending_review_count) },
  };
}

export function similarCustomers(
  database: AppDatabase,
  url: URL,
  organizationId: string,
  kind: DebtPartyKind = 'customer',
) {
  const profile = partyProfile(kind);
  const query = normalizeSearch(url.searchParams.get('q') ?? '');
  if (query.length < 2) return { items: [] };
  const tokens = [...new Set(query.split(' ').filter((token) => token.length >= 2))].slice(0, 6);
  if (!tokens.length) return { items: [] };
  const ftsQuery = tokens.map((token) => `"${token.replaceAll('"', '""')}"*`).join(' OR ');
  const rows = database.prepare(`
    SELECT c.id,c.name,c.phone,c.current_balance_units,bm25(customer_name_search) AS search_rank
    FROM customer_name_search
    JOIN customers c ON c.id=customer_name_search.customer_id
    WHERE customer_name_search MATCH ?
      AND customer_name_search.organization_id=? AND customer_name_search.section_key=?
      AND c.deleted_at IS NULL
    ORDER BY c.normalized_name=? DESC, search_rank, c.financial_updated_at DESC
    LIMIT 8
  `).all(ftsQuery, organizationId, profile.sectionKey, query) as Record<string, unknown>[];
  return { items: rows.map((row) => ({
    id: String(row.id), name: String(row.name), phone: row.phone ? String(row.phone) : null,
    balanceUnits: Number(row.current_balance_units), currency: profile.currency,
  })) };
}

export function customerSnapshot(
  database: AppDatabase,
  customerId: string,
  organizationId: string,
  kind: DebtPartyKind = 'customer',
) {
  const profile = partyProfile(kind);
  const row = database.prepare(`
    SELECT c.*, cy.id AS cycle_id, cy.initial_balance_units,
      (SELECT u.display_name
        FROM debt_assignments a JOIN users u ON u.id = a.assignee_user_id
        WHERE a.customer_id = c.id AND a.status = 'active'
        LIMIT 1) AS active_assignee_name
    FROM customers c
    JOIN customer_cycles cy ON cy.customer_id = c.id AND cy.status = 'active'
    WHERE c.id = ? AND c.organization_id = ? AND c.section_key = ? AND c.deleted_at IS NULL
  `).get(customerId, organizationId, profile.sectionKey) as Record<string, unknown> | undefined;
  if (!row) throw notFound(profile.missing);
  const balanceUnits = Number(row.current_balance_units);
  const debtStartedAt = row.debt_started_at ? String(row.debt_started_at) : null;
  const inactiveSince = row.inactive_since ? String(row.inactive_since) : null;
  const isPinned = Number(row.is_pinned) === 1;
  const hideBefore = Date.now() - 30 * 24 * 60 * 60_000;
  return {
    id: String(row.id),
    name: String(row.name),
    phone: row.phone ? String(row.phone) : null,
    version: Number(row.version),
    activeCycleId: String(row.cycle_id),
    openingBalanceUnits: Number(row.initial_balance_units),
    balanceUnits,
    currency: profile.currency,
    isPinned,
    inactiveSince,
    zeroReview: zeroReviewSnapshot(row),
    hiddenFromDefault: balanceUnits === 0 && !isPinned && !zeroReviewSnapshot(row)?.pending
      && inactiveSince !== null && new Date(inactiveSince).getTime() <= hideBefore,
    debtStartedAt,
    debtAgeDays: debtStartedAt && balanceUnits > 0
      ? Math.max(0, Math.floor((Date.now() - new Date(debtStartedAt).getTime()) / (24 * 60 * 60_000)))
      : null,
    activeAssigneeName: row.active_assignee_name ? String(row.active_assignee_name) : null,
    systemManaged: Boolean(row.system_link_key),
    systemLinkKey: row.system_link_key ? String(row.system_link_key) : null,
    nextSequence: Number(row.ledger_next_sequence),
    createdAt: String(row.created_at),
    updatedAt: String(row.financial_updated_at ?? row.updated_at),
  };
}
export function customerLedger(
  database: AppDatabase,
  customerId: string,
  url: URL,
  organizationId: string,
  kind: DebtPartyKind = 'customer',
) {
  const customer = customerAccount(database, customerId, organizationId, kind);
  if (customer.systemLinkKey) {
    const balanceUnits = customer.currentBalanceUnits;
    const profile = partyProfile(kind);
    const changedAt = String((database.prepare(
      'SELECT financial_updated_at FROM customers WHERE id=?',
    ).get(customer.id) as { financial_updated_at: string }).financial_updated_at);
    return {
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        version: customer.version,
        openingBalanceUnits: 0,
        balanceUnits,
        currency: profile.currency,
        isPinned: true,
        inactiveSince: customer.inactiveSince,
        nextSequence: 1,
        systemManaged: true,
        systemLinkKey: customer.systemLinkKey,
      },
      pageOpeningBalanceUnits: 0,
      totalItems: balanceUnits === 0 ? 0 : 1,
      items: balanceUnits === 0 ? [] : [{
        id: `linked:${customer.systemLinkKey}`,
        type: balanceUnits > 0 ? 'debt' : 'payment',
        amountUnits: Math.abs(balanceUnits),
        currency: profile.currency,
        paymentMode: null,
        calculationMode: 'direct',
        inputValue: Math.abs(balanceUnits),
        factorMicros: null,
        transactionDate: changedAt,
        referenceNo: customer.systemLinkKey === 'masraweya_remainder' ? 'LINK-MASRAWEYA' : 'LINK-VODAFONE',
        note: 'رصيد مرتبط تلقائيًا بالقسم المصدر',
        actorName: 'النظام',
        actorIsOwner: false,
        sequence: 1,
        status: 'posted',
        correctsTransactionId: null,
        createdAt: changedAt,
        updatedAt: changedAt,
      }],
      nextCursor: null,
    };
  }
  const limit = pageLimit(url.searchParams.get('limit'), 100);
  const requestedCursor = url.searchParams.get('before');
  const before = requestedCursor === null ? null : Number(requestedCursor);
  if (before !== null && (!Number.isSafeInteger(before) || before <= 0)) {
    throw badRequest('INVALID_LEDGER_CURSOR', 'مؤشر صفحة السجل غير صالح.');
  }
  const rows = database.prepare(`
    SELECT t.*,COALESCE(u.is_owner,0) AS actor_is_owner FROM debt_transactions t
    LEFT JOIN users u ON u.id=t.actor_user_id
    WHERE t.customer_id = ? AND t.deleted_at IS NULL AND t.transaction_status <> 'corrected'
      AND (? IS NULL OR customer_sequence < ?)
    ORDER BY customer_sequence DESC, created_at DESC
    LIMIT ?
  `).all(customerId, before, before, limit + 1) as Record<string, unknown>[];
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit).reverse();
  const sequenceRow = database.prepare(
    'SELECT ledger_next_sequence FROM customers WHERE id = ?',
  ).get(customerId) as { ledger_next_sequence: number };
  const cycleRow = database.prepare(
    'SELECT initial_balance_units FROM customer_cycles WHERE id = ?',
  ).get(customer.cycleId) as { initial_balance_units: number };
  const oldestSequence = pageRows.length ? Number(pageRows[0].customer_sequence) : Number(sequenceRow.ledger_next_sequence);
  const prior = database.prepare(`
    SELECT COALESCE(SUM(CASE WHEN entry_type = 'debt' THEN amount_units ELSE -amount_units END), 0) AS amount
    FROM debt_transactions
    WHERE customer_id = ? AND deleted_at IS NULL AND transaction_status = 'posted'
      AND customer_sequence < ?
  `).get(customerId, oldestSequence) as { amount: number };
  const total = database.prepare(`
    SELECT COUNT(*) AS count FROM debt_transactions
    WHERE customer_id = ? AND deleted_at IS NULL AND transaction_status <> 'corrected'
  `).get(customerId) as { count: number };
  return {
    customer: {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      version: customer.version,
      openingBalanceUnits: Number(cycleRow.initial_balance_units),
      balanceUnits: customerBalance(database, customer.cycleId),
      currency: partyProfile(kind).currency,
      isPinned: customer.isPinned,
      inactiveSince: customer.inactiveSince,
      nextSequence: Number(sequenceRow.ledger_next_sequence),
    },
    pageOpeningBalanceUnits: Number(cycleRow.initial_balance_units) + Number(prior.amount),
    totalItems: Number(total.count),
    items: pageRows.map((row) => ({
      id: String(row.id),
      type: String(row.entry_type),
      amountUnits: Number(row.amount_units),
      currency: String(row.currency),
      paymentMode: row.payment_mode ? String(row.payment_mode) : null,
      calculationMode: String(row.calculation_mode),
      inputValue: Number(row.input_value_micros) / 1_000_000,
      factorMicros: row.calculation_factor_micros === null ? null : Number(row.calculation_factor_micros),
      transactionDate: String(row.transaction_date),
      referenceNo: String(row.reference_no),
      note: String(row.note),
      actorName: String(row.actor_name),
      actorIsOwner: Number(row.actor_is_owner) === 1,
      sequence: Number(row.customer_sequence),
      status: String(row.transaction_status),
      correctsTransactionId: row.corrects_transaction_id ? String(row.corrects_transaction_id) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    })),
    nextCursor: hasMore && pageRows.length ? String(pageRows[0].customer_sequence) : null,
  };
}

