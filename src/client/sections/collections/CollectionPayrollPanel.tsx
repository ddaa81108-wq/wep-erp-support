import { uiText } from '../../i18n/language.ts';
import { useRealtimeRefresh } from '../../realtime/useRealtimeRefresh.ts';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Check, Coins, Plus, WalletCards } from 'lucide-react';
import { api } from '../../api.ts';
import type { CollectionPayrollDashboard, CollectionPayrollEmployee } from '../../apiTypes.ts';
import { collectionMoney, collectionError } from './useCollectionsDashboard.ts';

export function CollectionPayrollPanel({ isAdmin, onClose }: { isAdmin: boolean; onClose: () => void }) {
  const [data, setData] = useState<CollectionPayrollDashboard | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState('');
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
    setBusy('entry'); setError('');
    try { await api.createCollectionPayrollEntry(selected.employeeId, entryKind, amountUnits, reason, crypto.randomUUID()); form.reset(); await load(); }
    catch (caught) { setError(collectionError(caught)); } finally { setBusy(''); }
  }
  async function saveSalary(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return;
    const amountUnits = Number(new FormData(event.currentTarget).get('baseSalaryUnits'));
    if (!Number.isSafeInteger(amountUnits) || amountUnits < 0) return setError(uiText("اكتب مرتبًا ثابتًا صحيحًا غير سالب."));
    setBusy('salary'); setError('');
    try { await api.updateCollectionPayrollSalary(selected.employeeId, amountUnits); await load(); }
    catch (caught) { setError(collectionError(caught)); } finally { setBusy(''); }
  }
  async function confirm(entryId: string) {
    setBusy(entryId); setError('');
    try { await api.confirmCollectionPayrollEntry(entryId); await load(); }
    catch (caught) { setError(collectionError(caught)); } finally { setBusy(''); }
  }
  if (!data) return <section className="collection-panel payroll-panel"><div className="spinner" />{uiText("جارٍ تحميل المرتبات…")}</section>;
  return <div className="payroll-workspace">
    <header className="payroll-heading"><div><h2>{uiText("مرتبات موظفي الاستلام")}</h2><p>{uiText("الفترة الحالية: ")}{data.period}</p></div><button className="secondary payroll-back" onClick={onClose}><ArrowRight size={15} /> {uiText(" العودة للاستلامات")}</button></header>
    {error && <div className="alert error">{error}</div>}
    {isAdmin && data.employees.length > 0 && <label className="payroll-employee-picker">{uiText("الموظف")}<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{data.employees.map((employee) => <option key={employee.employeeId} value={employee.employeeId}>{employee.employeeName}</option>)}</select></label>}
    {selected ? <>
      <section className="payroll-metrics">
        <article><span>{uiText("المرتب الثابت")}</span><strong>{collectionMoney.format(selected.baseSalaryUnits)} {uiText(" د.ل")}</strong></article>
        <article className={selected.showOpeningCarry ? 'payroll-carry-visible' : ''}><span>{selected.showOpeningCarry ? uiText("الباقي من الشهر القديم") : uiText("المرحل السابق")}</span><strong>{collectionMoney.format(selected.openingCarryUnits)} {uiText(" د.ل")}</strong></article>
        <article><span>{uiText("العمولات والمكافآت")}</span><strong>{collectionMoney.format(selected.commissionsUnits)} {uiText(" د.ل")}</strong></article>
        <article><span>{uiText("إجمالي السحب")}</span><strong>{collectionMoney.format(selected.withdrawalsUnits)} {uiText(" د.ل")}</strong></article>
        <article className={selected.remainingUnits < 0 ? 'negative' : 'positive'}><span>{uiText("الباقي من المرتب")}</span><strong>{collectionMoney.format(selected.remainingUnits)} {uiText(" د.ل")}</strong></article>
      </section>
      {isAdmin && <section className="collection-panel payroll-admin-actions"><h3>{uiText("إضافة حركة للموظف")}</h3><div className="payroll-kind-tabs"><button className={entryKind === 'withdrawal' ? 'active' : ''} onClick={() => setEntryKind('withdrawal')}><WalletCards size={15} /> {uiText(" إضافة سحب")}</button><button className={entryKind === 'commission' ? 'active' : ''} onClick={() => setEntryKind('commission')}><Coins size={15} /> {uiText(" إضافة عمولة أو مكافأة")}</button></div><form className="payroll-entry-form" onSubmit={addEntry}><label>{uiText("القيمة")}<input name="amountUnits" type="number" min="1" step="1" inputMode="numeric" required /></label><label>{uiText("السبب")}<input name="reason" maxLength={300} required placeholder={entryKind === 'withdrawal' ? uiText("سبب السحب") : uiText("سبب العمولة أو المكافأة")} /></label><button className="primary" disabled={busy !== ''}><Plus size={15} /> {uiText(" إضافة")}</button></form><form className="payroll-salary-form" onSubmit={saveSalary}><label>{uiText("المرتب الثابت")}<input name="baseSalaryUnits" type="number" min="0" step="1" defaultValue={selected.baseSalaryUnits} /></label><button className="secondary" disabled={busy !== ''}>{uiText("حفظ المرتب")}</button></form></section>}
      <section className="collection-panel payroll-ledger-panel"><h3>{uiText("سجل المرتب — ")}{selected.employeeName}</h3>{selected.entries.length === 0 ? <p className="muted">{uiText("لا توجد حركات في هذه الفترة.")}</p> : <div className="payroll-ledger">{selected.entries.map((entry) => <article key={entry.id} className={entry.kind === 'withdrawal' ? 'payroll-withdrawal' : 'payroll-commission'}><div><strong>{entry.kind === 'withdrawal' ? uiText("سحب") : uiText("عمولة / مكافأة")}</strong><span>{entry.reason}</span></div><b>{collectionMoney.format(entry.amountUnits)} {uiText(" د.ل")}</b><small>{entry.createdByName} • {new Date(entry.createdAt).toLocaleString('ar-EG')}</small>{entry.confirmedAt ? <em><Check size={13} /> {uiText(" تم التأكيد")}</em> : isAdmin ? <em className="pending-confirmation">{uiText("بانتظار تأكيد الموظف")}</em> : <button className="confirm-payroll" disabled={busy === entry.id} onClick={() => void confirm(entry.id)}><Check size={14} /> {uiText(" تأكيد الاستلام")}</button>}</article>)}</div>}</section>
    </> : <section className="collection-panel"><p className="muted">{uiText("لا يوجد موظف استلام مفعّل حاليًا.")}</p></section>}
  </div>;
}
