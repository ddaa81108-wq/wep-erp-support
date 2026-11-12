import { useState, type FormEvent } from 'react';
import { Check, X } from 'lucide-react';
import type { TreasuryCashEntry } from '../../api.ts';
import { uiText, displayLocale } from '../../i18n/language.ts';
import { useUnsavedForm } from '../../dashboard/useUnsavedForm.ts';
import { treasuryNumberFormat as money, treasuryDesktopDate } from './treasuryViewModel.ts';

export type CashCorrectionValues = { direction: 'in' | 'out'; amountUnits: number; description: string };

export function TreasuryCorrectionForm({
  entry,
  busy,
  locked,
  onSave,
  onCancel,
}: {
  entry: TreasuryCashEntry;
  busy: boolean;
  locked: boolean;
  onSave: (values: CashCorrectionValues) => void;
  onCancel: () => void;
}) {
  const [direction, setDirection] = useState(entry.direction);
  const [amount, setAmount] = useState(String(entry.amountUnits));
  const [description, setDescription] = useState(entry.description);
  const { bindForm, trackChanges, confirmLeave } = useUnsavedForm(busy);
  const value = Number(amount),
    validAmount = Number.isSafeInteger(value) && value > 0;
  const effect = BigInt(validAmount ? value : 0) * (direction === 'in' ? 1n : -1n);
  const after = BigInt(entry.balanceBeforeUnits) + effect;
  const changed =
    direction !== entry.direction || value !== entry.amountUnits || description.trim() !== entry.description;
  const valid =
    validAmount &&
    changed &&
    after <= BigInt(Number.MAX_SAFE_INTEGER) &&
    after >= BigInt(Number.MIN_SAFE_INTEGER);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (valid && !busy) onSave({ direction, amountUnits: value, description });
  }
  return (
    <form
      ref={bindForm}
      onInput={trackChanges}
      onChange={trackChanges}
      onSubmit={submit}
      className={`treasury-ledger-row treasury-inline-edit ${direction}`}
      data-sequence={entry.sequence}
      aria-label={uiText('تصحيح معاملة الخزينة')}
    >
      <span data-label={uiText('التسلسل')}>{entry.sequence}</span>
      <span data-label={uiText('التاريخ')}>
        <time className="treasury-date-phone" dateTime={entry.createdAt}>
          {new Date(entry.createdAt).toLocaleString(displayLocale)}
        </time>
        <time className="treasury-date-desktop" dateTime={entry.createdAt}>
          {treasuryDesktopDate.format(new Date(entry.createdAt))}
        </time>
      </span>
      <span data-label={uiText('الحركة')}>
        <select
          aria-label={uiText('الحركة الصحيحة')}
          value={direction}
          disabled={locked || busy}
          onChange={(event) => setDirection(event.target.value as 'in' | 'out')}
        >
          <option value="in">{uiText('دخول')}</option>
          <option value="out">{uiText('خروج')}</option>
        </select>
      </span>
      <span data-label={uiText('القيمة')}>
        <input
          aria-label={uiText('القيمة الصحيحة')}
          type="number"
          inputMode="numeric"
          min="1"
          step="1"
          required
          value={amount}
          disabled={locked || busy}
          onChange={(event) => setAmount(event.target.value)}
        />
      </span>
      <span data-label={uiText('البيان')}>
        <input
          aria-label={uiText('البيان المصحح')}
          maxLength={500}
          value={description}
          disabled={locked || busy}
          onChange={(event) => setDescription(event.target.value)}
        />
      </span>
      <span data-label={uiText('بواسطة')}>{entry.actorIsOwner ? '—' : entry.actorName}</span>
      <span data-label={uiText('الرصيد')} dir="ltr">
        {validAmount ? money.format(after) : '—'}
      </span>
      <span className="treasury-row-actions" data-label={uiText('الإجراءات')}>
        <button
          type="submit"
          className="treasury-correct-button save"
          title={uiText('حفظ التعديل')}
          aria-label={locked ? uiText('إعادة محاولة التأكيد') : uiText('حفظ التعديل')}
          disabled={busy || !valid}
        >
          <Check size={15} />
        </button>
        <button
          type="button"
          className="treasury-correct-button"
          title={uiText('إلغاء التعديل')}
          aria-label={uiText('إلغاء التعديل')}
          disabled={busy}
          onClick={() => {
            if (confirmLeave()) onCancel();
          }}
        >
          <X size={15} />
        </button>
      </span>
    </form>
  );
}
