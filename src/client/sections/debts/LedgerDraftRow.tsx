import { uiText } from '../../i18n/language.ts';
import { useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Check, X } from 'lucide-react';
import { ApiError, type Ledger, type LedgerItem, type ConfirmedLedgerWrite } from '../../api.ts';
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
  onSaved: (message: string, saved?: ConfirmedLedgerWrite) => Promise<void>;
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
      const saved = editing
        ? await editSectionTransaction(section, ledger.customer.id, editing.id, body)
        : await addSectionTransaction(section, ledger.customer.id, body);
      if (!editing) localStorage.removeItem(draftKey);
      await onSaved(editing ? uiText("تم تعديل المعاملة في مكانها.") : uiText("تم اعتماد المعاملة وإضافة سطر جديد فارغ."), { ...saved, customerId: ledger.customer.id });
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
        else { event.currentTarget.reportValidity(); setError(uiText("أكمل القيمة والسعر بشكل صحيح قبل اعتماد المعاملة.")); }
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
        <span>{uiText("التسلسل")}</span>
        <strong>#{editing?.sequence ?? ledger.customer.nextSequence}</strong>
      </div>
      <label className="ledger-draft-field">
        <span>{uiText("اليوم والتاريخ")}</span>
        <input
          aria-label={uiText("تاريخ المعاملة")}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </label>
      <div className="ledger-draft-field">
        <span>{uiText("النوع")}</span>
        {(section === 'customers' || section === 'companies' || section === 'libyan-deposits' || section === 'egyptian-deposits') ? <div className="ledger-choice-group" role="group" aria-label={uiText("نوع المعاملة")}>
          {(section === 'egyptian-deposits' ? [['debt', uiText("إيداع مصري")], ['partial', uiText("سحب مصري")]] as const : section === 'libyan-deposits' ? [['debt', uiText("إيداع أمانة")], ['partial', uiText("سحب أمانة")]] as const : [['debt', uiText("ديون")], ['partial', uiText("دفع جزئي", [], 'compact')], ['full', uiText("دفع كلي", [], 'compact')]] as const).map(([choice, label]) =>
            <button type="button" key={choice} className={`ledger-choice choice-${choice}`} aria-pressed={kind === choice} onClick={() => setKind(choice)}>{label}</button>)}
        </div> :
        <select
          aria-label={uiText("نوع المعاملة")}
          value={kind}
          onChange={(e) => setKind(e.target.value as LedgerDraftKind)}
        >
          <option value="debt">{isDepositSection(section) ? uiText("دخول", [], 'ledger') : uiText("دين")}</option>
          <option value="partial">{isDepositSection(section) ? uiText("خروج") : uiText("سداد جزئي")}</option>
          {!isDepositSection(section) && <option value="full">{uiText("سداد كامل")}</option>}
        </select>}
      </div>
      <label className="ledger-draft-field">
        <span>{uiText("البيان")}</span>
        <input
          aria-label={uiText("ملاحظة المعاملة")}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
          placeholder={uiText("بيان الحركة")}
        />
      </label>
      <label className="ledger-draft-field ledger-fitted-amount">
        <span>{uiText("القيمة")}</span>
        <input
          ref={amountRef}
          data-fit-amount=""
          aria-label={uiText("قيمة المعاملة")}
          data-ledger-amount=""
          type="number"
          min="1"
          step="1"
          value={displayedAmount}
          onChange={(e) => setValue(e.target.value)}
          disabled={kind === 'full'}
          required
        />
        {showFullValue && <output className="ledger-full-amount" aria-live="polite">{uiText("القيمة كاملة: ")}<bdi>{displayedAmount}</bdi></output>}
      </label>
      <div className="ledger-draft-field">
        <span>{uiText("الحساب")}</span>
        {(section === 'customers' || section === 'companies' || section === 'libyan-deposits' || section === 'egyptian-deposits') ? <div className="ledger-choice-group" role="group" aria-label={uiText("طريقة الحساب")}>
          {([['direct', uiText("مباشر")], ['divide', uiText("قسمة")], ['multiply', uiText("ضرب")]] as const).map(([choice, label]) =>
            <button type="button" key={choice} className={`ledger-choice choice-${choice}`} aria-label={label} title={label} aria-pressed={(kind === 'full' ? 'direct' : mode) === choice} disabled={kind === 'full'} onClick={() => setMode(choice)}>{choice === 'divide' ? '÷' : choice === 'multiply' ? '×' : label}</button>)}
        </div> :
        <select
          aria-label={uiText("طريقة الحساب")}
          value={kind === 'full' ? 'direct' : mode}
          onChange={(e) => setMode(e.target.value as LedgerCalculationMode)}
          disabled={kind === 'full'}
        >
          <option value="direct">{uiText("مباشرة")}</option>
          <option value="multiply">{uiText("ضرب")}</option>
          <option value="divide">{uiText("قسمة")}</option>
        </select>}
      </div>
      <label className="ledger-draft-field">
        <span>{(section === 'customers' || section === 'companies' || section === 'libyan-deposits' || section === 'egyptian-deposits') ? uiText("السعر") : uiText("المعامل")}</span>
        <input
          aria-label={(section === 'customers' || section === 'companies' || section === 'libyan-deposits' || section === 'egyptian-deposits') ? uiText("السعر") : uiText("المعامل")}
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
        <span>{isDepositSection(section) ? (section === 'libyan-deposits' ? uiText("إيداع أمانة") : uiText("إيداع مصري")) : uiText("دين مضاف")}</span>
        <strong>{kind === 'debt' ? `${ledgerMoney.format(result)} ${currencyLabel(section)}` : '—'}</strong>
      </div>
      <div className="ledger-draft-field draft-result payment-value">
        <span>{isDepositSection(section) ? (section === 'libyan-deposits' ? uiText("سحب أمانة") : uiText("سحب مصري")) : uiText("مدفوع")}</span>
        <strong>{kind !== 'debt' ? `${ledgerMoney.format(result)} ${currencyLabel(section)}` : '—'}</strong>
      </div>
      <div className="ledger-draft-field draft-result">
        <span>{uiText("الرصيد")}</span>
        <strong>
          {ledgerMoney.format(projectedBalance)} {currencyLabel(section)}
        </strong>
      </div>
      <button
        className="row-action approve"
        aria-label={uiText("اعتماد المعاملة")}
        title={uiText("اعتماد المعاملة")}
        disabled={busy || result <= 0}
      >
        <Check size={18} />
      </button>
      <button
        type="button"
        className="row-action cancel"
        aria-label={uiText("إلغاء المسودة")}
        title={uiText("إلغاء المسودة")}
        onClick={() => { if (!editing) localStorage.removeItem(draftKey); onClose(); }}
      >
        <X size={18} />
      </button>
      {error && <div className="draft-error">{error}</div>}
      {!editing && wasRestored && <div className="draft-restored">{uiText("تمت استعادة المسودة غير المحفوظة.")}</div>}
    </form>
  );
}
