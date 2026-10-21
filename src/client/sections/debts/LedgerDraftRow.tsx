import { useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Check, X } from 'lucide-react';
import { ApiError, type Ledger, type LedgerItem } from '../../api.ts';
import { addSectionTransaction, editSectionTransaction } from './debtSectionApi.ts';
import { currencyLabel, isDepositSection } from './debtSectionUtils.ts';
import {
  ledgerBalanceBeforeDraft,
  ledgerDraftResult,
  ledgerErrorText,
  ledgerItemKind,
  ledgerMoney,
  type LedgerCalculationMode,
  type LedgerDraftKind,
} from './ledgerModel.ts';
import type { DebtSection } from './sectionConfig.ts';
import { useFittedAmountInput } from '../../components/useFittedAmountInput.ts';

type Props = {
  section: DebtSection;
  ledger: Ledger;
  editing: LedgerItem | null;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
  onConflict: () => Promise<void>;
};

type SavedDraft = { kind: LedgerDraftKind; mode: LedgerCalculationMode; value: string; factor: string; date: string; note: string };
function savedDraft(key: string): SavedDraft | null {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') as SavedDraft | null; } catch { return null; }
}

export function LedgerDraftRow({ section, ledger, editing, onClose, onSaved, onConflict }: Props) {
  const draftKey = `abdo-ledger-draft:${section}:${ledger.customer.id}`;
  const restored = editing ? null : savedDraft(draftKey);
  const [wasRestored] = useState(Boolean(restored));
  const [kind, setKind] = useState<LedgerDraftKind>(editing ? ledgerItemKind(editing) : restored?.kind ?? (section === 'libyan-deposits' ? 'partial' : 'debt'));
  const [mode, setMode] = useState<LedgerCalculationMode>(editing?.calculationMode ?? restored?.mode ?? 'direct');
  const [value, setValue] = useState(editing ? String(editing.inputValue) : restored?.value ?? '');
  const [factor, setFactor] = useState(editing?.factorMicros ? String(editing.factorMicros / 1_000_000) : restored?.factor ?? '');
  const [date, setDate] = useState((editing?.transactionDate ?? restored?.date ?? new Date().toISOString()).slice(0, 10));
  const [note, setNote] = useState(editing?.note ?? restored?.note ?? '');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState('');
  const balanceBefore = ledgerBalanceBeforeDraft(ledger, editing);
  const result = useMemo(
    () => ledgerDraftResult(kind, mode, value, factor, balanceBefore),
    [balanceBefore, factor, kind, mode, value],
  );
  const projectedBalance = kind === 'debt' ? balanceBefore + result : balanceBefore - result;
  const displayedAmount = kind === 'full' ? Math.max(0, balanceBefore) : value;
  const { ref: amountRef, showFullValue } = useFittedAmountInput(displayedAmount);
  useLayoutEffect(() => {
    if (editing) return;
    const hasContent = Boolean(value || factor || note);
    if (hasContent) localStorage.setItem(draftKey, JSON.stringify({ kind, mode, value, factor, date, note } satisfies SavedDraft));
    else localStorage.removeItem(draftKey);
  }, [date, draftKey, editing, factor, kind, mode, note, value]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || result <= 0) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    const body = {
      requestId: crypto.randomUUID(),
      expectedVersion: ledger.customer.version,
      type: kind === 'debt' ? ('debt' as const) : ('payment' as const),
      paymentMode:
        kind === 'full' ? ('full' as const) : kind === 'partial' ? ('partial' as const) : undefined,
      inputValue: kind === 'full' ? 1 : Number(value),
      calculationMode: kind === 'full' ? ('direct' as const) : mode,
      factor: mode === 'direct' || kind === 'full' ? undefined : Number(factor),
      date: new Date(date).toISOString(),
      note,
    };
    try {
      if (editing) await editSectionTransaction(section, ledger.customer.id, editing.id, body);
      else await addSectionTransaction(section, ledger.customer.id, body);
      if (!editing) localStorage.removeItem(draftKey);
      await onSaved(editing ? 'تم تعديل المعاملة في مكانها.' : 'تم اعتماد المعاملة وإضافة سطر جديد فارغ.');
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'VERSION_CONFLICT') await onConflict();
      setError(ledgerErrorText(caught));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  function navigateFields(event: KeyboardEvent<HTMLFormElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
    const target = event.target as HTMLElement;
    if (event.nativeEvent.isComposing || target instanceof HTMLTextAreaElement) return;
    if (target instanceof HTMLButtonElement) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!busy && !submitting.current) {
        if (result > 0) event.currentTarget.requestSubmit();
        else { event.currentTarget.reportValidity(); setError('أكمل القيمة والسعر بشكل صحيح قبل اعتماد المعاملة.'); }
      }
      return;
    }
    const controls = [
      ...event.currentTarget.querySelectorAll<HTMLElement>(
        'input:not(:disabled), select:not(:disabled), button:not(:disabled)',
      ),
    ];
    const current = controls.indexOf(target);
    if (current < 0) return;
    event.preventDefault();
    const step = event.key === 'ArrowUp' ? -1 : 1;
    controls[Math.max(0, Math.min(controls.length - 1, current + step))]?.focus();
  }

  return (
    <form className="ledger-grid ledger-draft-row" data-new-ledger-draft={!editing || undefined} onSubmit={submit} onKeyDown={navigateFields}>
      <div className="ledger-draft-field sequence-cell">
        <span>التسلسل</span>
        <strong>#{editing?.sequence ?? ledger.customer.nextSequence}</strong>
      </div>
      <label className="ledger-draft-field">
        <span>اليوم والتاريخ</span>
        <input
          aria-label="تاريخ المعاملة"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </label>
      <div className="ledger-draft-field">
        <span>النوع</span>
        {(section === 'customers' || section === 'companies' || section === 'libyan-deposits' || section === 'egyptian-deposits') ? <div className="ledger-choice-group" role="group" aria-label="نوع المعاملة">
          {(section === 'egyptian-deposits' ? [['debt', 'إيداع مصري'], ['partial', 'سحب مصري']] as const : section === 'libyan-deposits' ? [['debt', 'إيداع أمانة'], ['partial', 'سحب أمانة']] as const : [['debt', 'ديون'], ['partial', 'دفع جزئي'], ['full', 'دفع كلي']] as const).map(([choice, label]) =>
            <button type="button" key={choice} className={`ledger-choice choice-${choice}`} aria-pressed={kind === choice} onClick={() => setKind(choice)}>{label}</button>)}
        </div> :
        <select
          aria-label="نوع المعاملة"
          value={kind}
          onChange={(e) => setKind(e.target.value as LedgerDraftKind)}
        >
          <option value="debt">{isDepositSection(section) ? 'دخول' : 'دين'}</option>
          <option value="partial">{isDepositSection(section) ? 'خروج' : 'سداد جزئي'}</option>
          {!isDepositSection(section) && <option value="full">سداد كامل</option>}
        </select>}
      </div>
      <label className="ledger-draft-field">
        <span>البيان</span>
        <input
          aria-label="ملاحظة المعاملة"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
          placeholder="بيان الحركة"
        />
      </label>
      <label className="ledger-draft-field ledger-fitted-amount">
        <span>القيمة</span>
        <input
          ref={amountRef}
          data-fit-amount=""
          aria-label="قيمة المعاملة"
          type="number"
          min="1"
          step="1"
          value={displayedAmount}
          onChange={(e) => setValue(e.target.value)}
          disabled={kind === 'full'}
          required
        />
        {showFullValue && <output className="ledger-full-amount" aria-live="polite">القيمة كاملة: <bdi>{displayedAmount}</bdi></output>}
      </label>
      <div className="ledger-draft-field">
        <span>الحساب</span>
        {(section === 'customers' || section === 'companies' || section === 'libyan-deposits' || section === 'egyptian-deposits') ? <div className="ledger-choice-group" role="group" aria-label="طريقة الحساب">
          {([['direct', 'مباشر'], ['divide', 'قسمة'], ['multiply', 'ضرب']] as const).map(([choice, label]) =>
            <button type="button" key={choice} className={`ledger-choice choice-${choice}`} aria-label={label} title={label} aria-pressed={(kind === 'full' ? 'direct' : mode) === choice} disabled={kind === 'full'} onClick={() => setMode(choice)}>{choice === 'divide' ? '÷' : choice === 'multiply' ? '×' : label}</button>)}
        </div> :
        <select
          aria-label="طريقة الحساب"
          value={kind === 'full' ? 'direct' : mode}
          onChange={(e) => setMode(e.target.value as LedgerCalculationMode)}
          disabled={kind === 'full'}
        >
          <option value="direct">مباشرة</option>
          <option value="multiply">ضرب</option>
          <option value="divide">قسمة</option>
        </select>}
      </div>
      <label className="ledger-draft-field">
        <span>{(section === 'customers' || section === 'companies' || section === 'libyan-deposits' || section === 'egyptian-deposits') ? 'السعر' : 'المعامل'}</span>
        <input
          aria-label={(section === 'customers' || section === 'companies' || section === 'libyan-deposits' || section === 'egyptian-deposits') ? 'السعر' : 'المعامل'}
          type="number"
          min="0.000001"
          step="any"
          value={factor}
          onChange={(e) => setFactor(e.target.value)}
          disabled={kind === 'full' || mode === 'direct'}
          placeholder="—"
          required={kind !== 'full' && mode !== 'direct'}
        />
      </label>
      <div className="ledger-draft-field draft-result debt-value">
        <span>{isDepositSection(section) ? (section === 'libyan-deposits' ? 'إيداع أمانة' : 'إيداع مصري') : 'دين مضاف'}</span>
        <strong>{kind === 'debt' ? `${ledgerMoney.format(result)} ${currencyLabel(section)}` : '—'}</strong>
      </div>
      <div className="ledger-draft-field draft-result payment-value">
        <span>{isDepositSection(section) ? (section === 'libyan-deposits' ? 'سحب أمانة' : 'سحب مصري') : 'مدفوع'}</span>
        <strong>{kind !== 'debt' ? `${ledgerMoney.format(result)} ${currencyLabel(section)}` : '—'}</strong>
      </div>
      <div className="ledger-draft-field draft-result">
        <span>الرصيد</span>
        <strong>
          {ledgerMoney.format(projectedBalance)} {currencyLabel(section)}
        </strong>
      </div>
      <button
        className="row-action approve"
        aria-label="اعتماد المعاملة"
        title="اعتماد المعاملة"
        disabled={busy || result <= 0}
      >
        <Check size={18} />
      </button>
      <button
        type="button"
        className="row-action cancel"
        aria-label="إلغاء المسودة"
        title="إلغاء المسودة"
        onClick={() => { if (!editing) localStorage.removeItem(draftKey); onClose(); }}
      >
        <X size={18} />
      </button>
      {error && <div className="draft-error">{error}</div>}
      {!editing && wasRestored && <div className="draft-restored">تمت استعادة المسودة غير المحفوظة.</div>}
    </form>
  );
}
