import type { DatabaseSync } from 'node:sqlite';

export function ensurePermanentCustomerLedgerColumns(database: DatabaseSync) {
  const columns = (table: string) =>
    new Set(
      (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
        (column) => column.name,
      ),
    );
  const customerColumns = columns('customers');
  if (!customerColumns.has('is_pinned')) {
    database.exec(
      'ALTER TABLE customers ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1))',
    );
  }
  if (!customerColumns.has('inactive_since')) {
    database.exec('ALTER TABLE customers ADD COLUMN inactive_since TEXT');
  }
  if (!customerColumns.has('ledger_next_sequence')) {
    database.exec(
      'ALTER TABLE customers ADD COLUMN ledger_next_sequence INTEGER NOT NULL DEFAULT 1 CHECK (ledger_next_sequence > 0)',
    );
  }

  const transactionColumns = columns('debt_transactions');
  if (!transactionColumns.has('customer_sequence')) {
    database.exec('ALTER TABLE debt_transactions ADD COLUMN customer_sequence INTEGER');
  }
  if (!transactionColumns.has('transaction_status')) {
    database.exec(
      "ALTER TABLE debt_transactions ADD COLUMN transaction_status TEXT NOT NULL DEFAULT 'posted' CHECK (transaction_status IN ('posted', 'corrected', 'reversed'))",
    );
  }
  if (!transactionColumns.has('corrects_transaction_id')) {
    database.exec(
      'ALTER TABLE debt_transactions ADD COLUMN corrects_transaction_id TEXT REFERENCES debt_transactions(id) ON DELETE RESTRICT',
    );
  }
  if (customerColumns.has('collector')) {
    database.exec('ALTER TABLE customers DROP COLUMN collector');
  }
}

export function rebuildCustomerFinancialSummaries(database: DatabaseSync) {
  const customers = database
    .prepare(
      `SELECT c.id,c.updated_at,cy.id AS cycle_id,cy.initial_balance_units,cy.start_date
       FROM customers c JOIN customer_cycles cy ON cy.customer_id=c.id AND cy.status='active'
       WHERE c.deleted_at IS NULL`,
    )
    .all() as Array<Record<string, unknown>>;
  const transactions = database
    .prepare(
      `SELECT customer_id,entry_type,amount_units,conversion_rate_micros,transaction_date,updated_at
       FROM debt_transactions
       WHERE deleted_at IS NULL AND transaction_status='posted'
       ORDER BY customer_id,customer_sequence ASC,created_at ASC`,
    )
    .all() as Array<Record<string, unknown>>;
  const byCustomer = new Map<string, Array<Record<string, unknown>>>();
  for (const row of transactions) {
    const id = String(row.customer_id);
    const list = byCustomer.get(id) ?? [];
    list.push(row);
    byCustomer.set(id, list);
  }
  const update = database.prepare(
    'UPDATE customers SET current_balance_units=?,debt_started_at=?,financial_updated_at=? WHERE id=?',
  );
  for (const customer of customers) {
    let balance = Number(customer.initial_balance_units);
    let debtStartedAt: string | null = balance > 0 ? String(customer.start_date) : null;
    let financialUpdatedAt = String(customer.updated_at);
    for (const row of byCustomer.get(String(customer.id)) ?? []) {
      const amount = Math.trunc(
        (Number(row.amount_units) * Number(row.conversion_rate_micros)) / 1_000_000,
      );
      const next = balance + (String(row.entry_type) === 'debt' ? amount : -amount);
      if (balance <= 0 && next > 0) debtStartedAt = String(row.transaction_date);
      if (next <= 0) debtStartedAt = null;
      balance = next;
      financialUpdatedAt = String(row.updated_at);
    }
    update.run(balance, debtStartedAt, financialUpdatedAt, String(customer.id));
  }
}
