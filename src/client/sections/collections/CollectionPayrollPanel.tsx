import { uiText } from '../../i18n/language.ts';
import { useUnsavedForm } from '../../dashboard/useUnsavedForm.ts';
import { flushBeforeNavigation } from '../../dashboard/navigationGuards.ts';
import { useRealtimeRefresh } from '../../realtime/useRealtimeRefresh.ts';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Coins, Plus, WalletCards } from 'lucide-react';
import { api } from '../../api.ts';
import type { CollectionPayrollDashboard, CollectionPayrollEmployee, CollectionPayrollEntry } from '../../apiTypes.ts';
import { collectionMoney, collectionError } from './useCollectionsDashboard.ts';
import { useRecoverableWrite } from '../../components/useRecoverableWrite.ts';
import { PayrollEntryRow } from './PayrollEntryRow.tsx';

type PayrollWrite = { employeeId: string; kind: 'withdrawal' | 'commission'; amountUnits: number; reason: string };

export function CollectionPayrollPanel({ userId, isAdmin, onClose }: { userId: string; isAdmin: boolean; onClose: () => void }) {
  const [data, setData] = useState<CollectionPayrollDashboard | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState('');
  const actionLocked = useRef(false);
  const entryForm = useRef<HTMLFormElement | null>(null);
  const entryWrite = useRecoverableWrite<PayrollWrite>(`abdo:payroll-write:${userId}`);
  const { bindForm: bindEntry, trackChanges: changeEntry, markSaved: savedEntry } = useUnsavedForm(busy === 'entry');
  const bindEntryForm = useCallback((form: HTMLFormElement | null) => {
    entryForm.current = form;
    bindEntry(form);
  }, [bindEntry]);
  const { bindForm: bindSalary, trackChanges: changeSalary, markSaved: savedSalary } = useUnsavedForm(busy === 'salary');
  const [error, setError] = useState('');
  const [entryKind, setEntryKind] = useState<'withdrawal' | 'commission'>('withdrawal');
  const latestLoad = useRef(0);
  const load = useCallback(async (quiet = false) => {
    const request = ++latestLoad.current;
    try {
      const result = await api.collectionPayroll();
      if (request !== latestLoad.current) return;
      setData(result); setSelectedId(current => current || result.employees[0]?.employeeId || '');
    } catch (caught) { if (quiet) throw caught; setError(collectionError(caught)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useRealtimeRefresh({ topics: ['collection.changed'], cursorKey: 'abdo:payroll-events', onChange: () => load(true) });

  const selected = useMemo<CollectionPayrollEmployee | undefined>(
    () => data?.employees.find((employee) => employee.employeeId === selectedId), [data, selectedId],
  );
  async function addEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return;
    const form = event.currentTarget; const values = new FormData(form);
    const amountUnits = Number(values.get('amountUnits')); const reason = String(values.get('reason') ?? '').trim();
    if (!Number.isSafeInteger(amountUnits) || amountUnits <= 0) return setError(uiText("اكتب قيمة صحيحة أكبر من صفر."));
    if (reason.length < 2) return setError(uiText("اكتب سبب الحركة بوضوح."));
    await writeEntry({ employeeId: selected.employeeId, kind: entryKind, amountUnits, reason });
  }
  async function writeEntry(payload: PayrollWrite | null) {
    if (actionLocked.current) return;
    actionLocked.current = true;
    setBusy('entry'); setError('');
    try {
      const confirmed = await entryWrite.run(payload,
        (values, requestId) => api.createCollectionPayrollEntry(values.employeeId, values.kind, values.amountUnits, values.reason, requestId),
        () => { entryForm.current?.reset(); savedEntry(); });
      if (confirmed) await load();
    }
    catch (caught) { setError(collectionError(caught)); } finally { actionLocked.current = false; setBusy(''); }
  }
  async function saveSalary(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected || actionLocked.current) return;
    const amountUnits = Number(new FormData(event.currentTarget).get('baseSalaryUnits'));
    if (!Number.isSafeInteger(amountUnits) || amountUnits < 0) return setError(uiText("اكتب مرتبًا ثابتًا صحيحًا غير سالب."));
    actionLocked.current = true; setBusy('salary'); setError('');
    try { await api.updateCollectionPayrollSalary(selected.employeeId, amountUnits); savedSalary(); await load(); }
    catch (caught) { setError(collectionError(caught)); } finally { actionLocked.current = false; setBusy(''); }
  }
  async function confirm(entryId: string) {
    if (actionLocked.current) return;
    actionLocked.current = true; setBusy(entryId); setError('');
    try { await api.confirmCollectionPayrollEntry(entryId); await load(); }
    catch (caught) { setError(collectionError(caught)); } finally { actionLocked.current = false; setBusy(''); }
  }
  async function cancelEntry(entry: CollectionPayrollEntry) {
    if (!isAdmin || entry.cancelledAt || actionLocked.current) return;
    if (!window.confirm(uiText('حذف هذه المعاملة بقيمة {0} د.ل؟ سيُصحح رصيد المرتب وتختفي من الصفحة، مع حفظ أثر الإلغاء في سجل التدقيق.', [collectionMoney.format(entry.amountUnits)]))) return;
    actionLocked.current = true; setBusy(entry.id); setError('');
    try { await api.cancelCollectionPayrollEntry(entry.id); await load(); }
    catch (caught) { setError(collectionError(caught)); } finally { actionLocked.current = false; setBusy(''); }
  }
  if (!data) return <section className="collection-panel payroll-panel"><div className="spinner" />{uiText("جارٍ تحميل المرتبات…")}</section>;
  return <div className="payroll-workspace">
    <header className="payroll-heading"><div><h2>{uiText("مرتبات موظفي الاستلام")}</h2><p>{uiText("الفترة الحالية: ")}{data.period}</p></div><button className="secondary payroll-back" onClick={() => { void flushBeforeNavigation().then(allowed => { if (allowed) onClose(); }); }}><ArrowRight size={15} /> {uiText(" العودة للاستلامات")}</button></header>
    {error && <div className="alert error">{error}</div>}
    {isAdmin && entryWrite.pending && <section className="collection-panel pending-payroll-recovery">
      <p>{uiText('حركة موظف تحتاج تأكيد نتيجة الإرسال')} — {data.employees.find(employee => employee.employeeId === entryWrite.pending?.payload.employeeId)?.employeeName} — {collectionMoney.format(entryWrite.pending.payload.amountUnits)} {uiText('د.ل')} — {entryWrite.pending.payload.reason}</p>
      <button disabled={busy !== '' || entryWrite.busy} onClick={() => void writeEntry(null)}>{uiText('إعادة التحقق من الحركة السابقة')}</button>
    </section>}
    {isAdmin && data.employees.length > 0 && <label className="payroll-employee-picker">{uiText("الموظف")}<select value={selectedId} onChange={(event) => { const next = event.target.value; void flushBeforeNavigation().then(allowed => { if (allowed) setSelectedId(next); }); }}>{data.employees.map((employee) => <option key={employee.employeeId} value={employee.employeeId}>{employee.employeeName}</option>)}</select></label>}
    {selected ? <>
      <section className="payroll-metrics">
        <article><span>{uiText("المرتب الثابت")}</span><strong>{collectionMoney.format(selected.baseSalaryUnits)} {uiText(" د.ل")}</strong></article>
        <article className={selected.showOpeningCarry ? 'payroll-carry-visible' : ''}><span>{selected.showOpeningCarry ? uiText("الباقي من الشهر القديم") : uiText("المرحل السابق")}</span><strong>{collectionMoney.format(selected.openingCarryUnits)} {uiText(" د.ل")}</strong></article>
        <article><span>{uiText("العمولات والمكافآت")}</span><strong>{collectionMoney.format(selected.commissionsUnits)} {uiText(" د.ل")}</strong></article>
        <article><span>{uiText("إجمالي السحب")}</span><strong>{collectionMoney.format(selected.withdrawalsUnits)} {uiText(" د.ل")}</strong></article>
        <article className={selected.remainingUnits < 0 ? 'negative' : 'positive'}><span>{uiText("الباقي من المرتب")}</span><strong>{collectionMoney.format(selected.remainingUnits)} {uiText(" د.ل")}</strong></article>
      </section>
      {isAdmin && <section className="collection-panel payroll-admin-actions"><h3>{uiText("إضافة حركة للموظف")}</h3><div className="payroll-kind-tabs"><button className={entryKind === 'withdrawal' ? 'active' : ''} onClick={() => setEntryKind('withdrawal')}><WalletCards size={15} /> {uiText(" إضافة سحب")}</button><button className={entryKind === 'commission' ? 'active' : ''} onClick={() => setEntryKind('commission')}><Coins size={15} /> {uiText(" إضافة عمولة أو مكافأة")}</button></div><form key={`entry:${selected.employeeId}`} ref={bindEntryForm} onInput={changeEntry} onChange={changeEntry} className="payroll-entry-form" onSubmit={addEntry}><label>{uiText("القيمة")}<input name="amountUnits" type="number" min="1" step="1" inputMode="numeric" required /></label><label>{uiText("السبب")}<input name="reason" maxLength={300} required placeholder={entryKind === 'withdrawal' ? uiText("سبب السحب") : uiText("سبب العمولة أو المكافأة")} /></label><button className="primary" disabled={busy !== ''}><Plus size={15} /> {uiText(" إضافة")}</button></form><form key={`salary:${selected.employeeId}`} ref={bindSalary} onInput={changeSalary} onChange={changeSalary} className="payroll-salary-form" onSubmit={saveSalary}><label>{uiText("المرتب الثابت")}<input name="baseSalaryUnits" type="number" min="0" step="1" defaultValue={selected.baseSalaryUnits} /></label><button className="secondary" disabled={busy !== ''}>{uiText("حفظ المرتب")}</button></form></section>}
      <section className="collection-panel payroll-ledger-panel"><h3>{uiText("سجل المرتب — ")}{selected.employeeName}</h3>{selected.entries.length === 0 ? <p className="muted">{uiText("لا توجد حركات في هذه الفترة.")}</p> : <div className="payroll-ledger">{selected.entries.map(entry => <PayrollEntryRow key={entry.id} entry={entry} isAdmin={isAdmin} busy={busy !== ""} onConfirm={id => void confirm(id)} onCancel={entry => void cancelEntry(entry)} />)}</div>}</section>
    </> : <section className="collection-panel"><p className="muted">{uiText("لا يوجد موظف استلام مفعّل حاليًا.")}</p></section>}
  </div>;
}
