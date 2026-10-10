import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../db/database.ts';
import { inImmediateTransaction, nowIso } from '../db/database.ts';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';
import { validateRequestId } from './customerTransactionSupport.ts';

const DEFAULT_BASE_SALARY_UNITS = 3500;

const payrollDate = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Tripoli', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return { period: `${value('year')}-${value('month')}`, day: Number(value('day')) };
};

const previousPeriod = (period: string) => {
  const [year, month] = period.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

function requireAdmin(actor: AuthenticatedUser) {
  if (actor.role !== 'admin') throw forbidden('collections.payroll.manage');
}

function employeeRow(db: AppDatabase, organizationId: string, employeeId: string) {
  const row = db.prepare(`SELECT u.id,u.organization_id,u.display_name AS displayName,u.username
    FROM users u
    WHERE u.id=? AND u.organization_id=? AND u.role='employee' AND u.is_active=1
      AND EXISTS(SELECT 1 FROM user_permissions p
        WHERE p.user_id=u.id AND p.permission='collections.read' AND p.allowed=1)`)
    .get(employeeId, organizationId) as Record<string, unknown> | undefined;
  if (!row) throw notFound('collection_employee');
  return row;
}

function monthTotals(db: AppDatabase, monthId: string) {
  const row = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN entry_kind='withdrawal' THEN amount_units ELSE 0 END),0) withdrawalsUnits,
      COALESCE(SUM(CASE WHEN entry_kind='commission' THEN amount_units ELSE 0 END),0) commissionsUnits
    FROM collection_payroll_entries WHERE month_id=?`).get(monthId) as Record<string, unknown>;
  return { withdrawalsUnits: Number(row.withdrawalsUnits), commissionsUnits: Number(row.commissionsUnits) };
}

function monthRemaining(db: AppDatabase, month: Record<string, unknown>) {
  const totals = monthTotals(db, String(month.id));
  return Number(month.base_salary_units) + Number(month.opening_carry_units)
    + totals.commissionsUnits - totals.withdrawalsUnits;
}

function ensureMonth(db: AppDatabase, organizationId: string, employeeId: string, period: string) {
  const existing = db.prepare(`SELECT * FROM collection_payroll_months
    WHERE organization_id=? AND employee_user_id=? AND period_key=?`)
    .get(organizationId, employeeId, period) as Record<string, unknown> | undefined;
  if (existing) return existing;
  const setting = db.prepare(`SELECT base_salary_units FROM collection_payroll_settings
    WHERE organization_id=? AND employee_user_id=?`).get(organizationId, employeeId) as
    { base_salary_units: number } | undefined;
  const previous = db.prepare(`SELECT * FROM collection_payroll_months
    WHERE organization_id=? AND employee_user_id=? AND period_key=?`)
    .get(organizationId, employeeId, previousPeriod(period)) as Record<string, unknown> | undefined;
  const openingCarry = previous ? monthRemaining(db, previous) : 0;
  db.prepare(`INSERT OR IGNORE INTO collection_payroll_months(
    id,organization_id,employee_user_id,period_key,base_salary_units,opening_carry_units,created_at
  ) VALUES(?,?,?,?,?,?,?)`).run(
    randomUUID(), organizationId, employeeId, period,
    setting ? Number(setting.base_salary_units) : DEFAULT_BASE_SALARY_UNITS,
    openingCarry, nowIso(),
  );
  return db.prepare(`SELECT * FROM collection_payroll_months
    WHERE organization_id=? AND employee_user_id=? AND period_key=?`)
    .get(organizationId, employeeId, period) as Record<string, unknown>;
}

function entryRows(db: AppDatabase, monthId: string) {
  return db.prepare(`SELECT e.id,e.entry_kind AS kind,e.amount_units AS amountUnits,e.reason,
      e.created_at AS createdAt,e.confirmed_at AS confirmedAt,
      creator.display_name AS createdByName,confirmer.display_name AS confirmedByName
    FROM collection_payroll_entries e
    JOIN users creator ON creator.id=e.created_by_user_id
    LEFT JOIN users confirmer ON confirmer.id=e.confirmed_by_user_id
    WHERE e.month_id=? ORDER BY e.created_at DESC,e.id DESC`).all(monthId);
}

function payrollSnapshot(db: AppDatabase, employee: Record<string, unknown>, period: string, showCarry: boolean) {
  const month = ensureMonth(db, String(employee.organization_id ?? employee.organizationId), String(employee.id), period);
  const totals = monthTotals(db, String(month.id));
  return {
    employeeId: String(employee.id),
    employeeName: String(employee.displayName ?? employee.display_name),
    username: String(employee.username),
    period,
    baseSalaryUnits: Number(month.base_salary_units),
    openingCarryUnits: Number(month.opening_carry_units),
    showOpeningCarry: showCarry,
    withdrawalsUnits: totals.withdrawalsUnits,
    commissionsUnits: totals.commissionsUnits,
    remainingUnits: Number(month.base_salary_units) + Number(month.opening_carry_units)
      + totals.commissionsUnits - totals.withdrawalsUnits,
    entries: entryRows(db, String(month.id)),
  };
}

function audit(
  db: AppDatabase, actor: AuthenticatedUser, action: string, entityId: string,
  correlationId: string, details: Record<string, unknown>,
) {
  db.prepare(`INSERT INTO audit_log(actor_user_id,organization_id,action,entity_type,entity_id,
    correlation_id,outcome,details_json,created_at)
    VALUES(?,?,?,'collection_payroll_entry',?,?,'success',?,?)`)
    .run(actor.id, actor.organizationId, action, entityId, correlationId, JSON.stringify(details), nowIso());
}

function notifyEmployee(
  db: AppDatabase, actor: AuthenticatedUser, employeeId: string, action: string,
  entityId: string, details: Record<string, unknown>,
) {
  db.prepare(`INSERT INTO notifications(organization_id,recipient_user_id,actor_user_id,action,
    entity_type,entity_id,section_key,details_json,created_at)
    VALUES(?,?,?,?,'collection_payroll_entry',?,'collections',?,?)`)
    .run(actor.organizationId, employeeId, actor.id, action, entityId, JSON.stringify(details), nowIso());
}

function emit(db: AppDatabase, actor: AuthenticatedUser, aggregateId: string, action: string) {
  const result = db.prepare(`INSERT INTO event_log(topic,aggregate_id,actor_user_id,organization_id,payload_json,created_at)
    VALUES('collection.changed',?,?,?,?,?)`).run(
    aggregateId, actor.id, actor.organizationId, JSON.stringify({ action }), nowIso(),
  );
  return Number(result.lastInsertRowid);
}

export function listCollectionPayroll(db: AppDatabase, actor: AuthenticatedUser) {
  const { period, day } = payrollDate();
  const employees = actor.role === 'admin'
    ? db.prepare(`SELECT u.id,u.organization_id,u.display_name AS displayName,u.username
        FROM users u WHERE u.organization_id=? AND u.role='employee' AND u.is_active=1
          AND EXISTS(SELECT 1 FROM user_permissions p
            WHERE p.user_id=u.id AND p.permission='collections.read' AND p.allowed=1)
        ORDER BY u.display_name COLLATE NOCASE`).all(actor.organizationId) as Record<string, unknown>[]
    : [employeeRow(db, actor.organizationId, actor.id)];
  return {
    period,
    employees: employees.map((employee) => payrollSnapshot(db, employee, period, day === 1)),
  };
}

export function createCollectionPayrollEntry(
  db: AppDatabase, actor: AuthenticatedUser, input: Record<string, unknown>, correlationId: string,
) {
  requireAdmin(actor);
  const employeeId = String(input.employeeUserId ?? '');
  const employee = employeeRow(db, actor.organizationId, employeeId);
  const kind = input.kind;
  if (kind !== 'withdrawal' && kind !== 'commission')
    throw badRequest('INVALID_PAYROLL_KIND', 'نوع حركة المرتب غير صالح.');
  const amountUnits = Number(input.amountUnits);
  if (!Number.isSafeInteger(amountUnits) || amountUnits <= 0)
    throw badRequest('INVALID_PAYROLL_AMOUNT', 'اكتب قيمة صحيحة أكبر من صفر.');
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 300) : '';
  if (reason.length < 2) throw badRequest('PAYROLL_REASON_REQUIRED', 'اكتب سبب الحركة بوضوح.');
  const requestId = validateRequestId(input.requestId);
  return inImmediateTransaction(db, () => {
    const previous = db.prepare(`SELECT * FROM collection_payroll_entries
      WHERE organization_id=? AND request_id=?`).get(actor.organizationId, requestId) as Record<string, unknown> | undefined;
    if (previous) {
      const same = String(previous.employee_user_id) === employeeId
        && String(previous.entry_kind) === kind
        && Number(previous.amount_units) === amountUnits
        && String(previous.reason) === reason;
      if (!same) throw conflict('IDEMPOTENCY_KEY_REUSED', 'مفتاح الطلب مستخدم في حركة مختلفة.');
      return { id: String(previous.id), replayed: true, eventSequences: [] };
    }
    const { period } = payrollDate();
    const month = ensureMonth(db, actor.organizationId, employeeId, period);
    const id = randomUUID();
    const createdAt = nowIso();
    db.prepare(`INSERT INTO collection_payroll_entries(id,organization_id,month_id,employee_user_id,
      entry_kind,amount_units,reason,request_id,created_by_user_id,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      id, actor.organizationId, String(month.id), employeeId, kind, amountUnits,
      reason, requestId, actor.id, createdAt,
    );
    const details = {
      employeeId,
      employeeName: String(employee.displayName),
      subjectName: String(employee.displayName),
      subjectSection: 'collections',
      payrollKind: kind,
      amountUnits,
      reason,
    };
    audit(db, actor, 'collection.payroll.entry.create', id, correlationId, details);
    notifyEmployee(db, actor, employeeId, 'collection.payroll.entry.create', id, details);
    return { id, createdAt, eventSequences: [emit(db, actor, employeeId, 'payroll_entry_created')] };
  });
}

export function updateCollectionPayrollSalary(
  db: AppDatabase, actor: AuthenticatedUser, employeeId: string,
  input: Record<string, unknown>, correlationId: string,
) {
  requireAdmin(actor);
  const employee = employeeRow(db, actor.organizationId, employeeId);
  const baseSalaryUnits = Number(input.baseSalaryUnits);
  if (!Number.isSafeInteger(baseSalaryUnits) || baseSalaryUnits < 0)
    throw badRequest('INVALID_BASE_SALARY', 'المرتب الثابت يجب أن يكون رقمًا صحيحًا غير سالب.');
  return inImmediateTransaction(db, () => {
    const at = nowIso();
    db.prepare(`INSERT INTO collection_payroll_settings(employee_user_id,organization_id,base_salary_units,
      updated_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(employee_user_id) DO UPDATE SET base_salary_units=excluded.base_salary_units,
        updated_by_user_id=excluded.updated_by_user_id,updated_at=excluded.updated_at`)
      .run(employeeId, actor.organizationId, baseSalaryUnits, actor.id, at, at);
    const { period } = payrollDate();
    const month = ensureMonth(db, actor.organizationId, employeeId, period);
    db.prepare('UPDATE collection_payroll_months SET base_salary_units=? WHERE id=?')
      .run(baseSalaryUnits, String(month.id));
    const details = {
      employeeId, employeeName: String(employee.displayName), subjectName: String(employee.displayName),
      subjectSection: 'collections', amountUnits: baseSalaryUnits,
    };
    audit(db, actor, 'collection.payroll.salary.update', employeeId, correlationId, details);
    notifyEmployee(db, actor, employeeId, 'collection.payroll.salary.update', employeeId, details);
    return { employeeId, baseSalaryUnits, eventSequences: [emit(db, actor, employeeId, 'payroll_salary_updated')] };
  });
}

export function confirmCollectionPayrollEntry(
  db: AppDatabase, actor: AuthenticatedUser, entryId: string, correlationId: string,
) {
  if (actor.role === 'admin') throw forbidden('collections.payroll.confirm');
  return inImmediateTransaction(db, () => {
    const row = db.prepare(`SELECT e.*,u.display_name AS employee_name
      FROM collection_payroll_entries e JOIN users u ON u.id=e.employee_user_id
      WHERE e.id=? AND e.organization_id=?`).get(entryId, actor.organizationId) as Record<string, unknown> | undefined;
    if (!row) throw notFound('payroll_entry');
    if (String(row.employee_user_id) !== actor.id) throw forbidden('collections.payroll.confirm');
    if (row.confirmed_at) return { id: entryId, confirmedAt: String(row.confirmed_at), replayed: true };
    const confirmedAt = nowIso();
    const changed = db.prepare(`UPDATE collection_payroll_entries
      SET confirmed_by_user_id=?,confirmed_at=? WHERE id=? AND confirmed_at IS NULL`)
      .run(actor.id, confirmedAt, entryId);
    if (Number(changed.changes) !== 1) throw conflict('PAYROLL_ALREADY_CONFIRMED', 'تم تأكيد الحركة من قبل.');
    audit(db, actor, 'collection.payroll.entry.confirm', entryId, correlationId, {
      employeeId: actor.id,
      employeeName: String(row.employee_name),
      subjectName: String(row.employee_name),
      subjectSection: 'collections',
      payrollKind: String(row.entry_kind),
      amountUnits: Number(row.amount_units),
      reason: String(row.reason),
    });
    return { id: entryId, confirmedAt, eventSequences: [emit(db, actor, actor.id, 'payroll_entry_confirmed')] };
  });
}
