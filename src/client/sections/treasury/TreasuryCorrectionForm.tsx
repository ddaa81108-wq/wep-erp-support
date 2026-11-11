import { useState, type FormEvent } from 'react';
import type { TreasuryCashEntry } from '../../api.ts';
import { uiText } from '../../i18n/language.ts';
import { useUnsavedForm } from '../../dashboard/useUnsavedForm.ts';
import { treasuryNumberFormat as money } from './treasuryViewModel.ts';

export type CashCorrectionValues = {
  direction: 'in' | 'out';
  amountUnits: number;
  description: string;
  reason: string;
};

export function TreasuryCorrectionForm({
  entry,
  balance,
  busy,
  locked,
  onSave,
  onCancel,
}: {
  entry: TreasuryCashEntry;
  balance: number;
  busy: boolean;
  locked: boolean;
  onSave: (values: CashCorrectionValues) => void;
  onCancel: () => void;
}) {
  const effective = entry.correction ?? entry;
  const [direction, setDirection] = useState(effective.direction);
  const [amount, setAmount] = useState(String(effective.amountUnits));
  const [description, setDescription] = useState(effective.description);
  const [reason, setReason] = useState('');
  const { bindForm, trackChanges, confirmLeave } = useUnsavedForm(busy);
  const value = Number(amount);
  const delta =
    BigInt(Number.isSafeInteger(value) && value > 0 ? value : 0) * (direction === 'in' ? 1n : -1n) -
    BigInt(effective.amountUnits) * (effective.direction === 'in' ? 1n : -1n);
  const projected = BigInt(balance) + delta;
  const valid =
    Number.isSafeInteger(value) &&
    value > 0 &&
    reason.trim().length > 0 &&
    delta <= BigInt(Number.MAX_SAFE_INTEGER) &&
    delta >= BigInt(Number.MIN_SAFE_INTEGER) &&
    projected <= BigInt(Number.MAX_SAFE_INTEGER) &&
    projected >= BigInt(Number.MIN_SAFE_INTEGER);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (valid && !busy) onSave({ direction, amountUnits: value, description, reason: reason.trim() });
  }
  return (
    <form
      ref={bindForm}
      onInput={trackChanges}
      onChange={trackChanges}
      onSubmit={submit}
      className="treasury-correction-form"
      aria-label={uiText('تصحيح معاملة الخزينة')}
    >
      <h3>{uiText('تعديل المعاملة {0}', [entry.sequence])}</h3>
      <p>{uiText('يُحفظ أصل المعاملة، ويُطبّق فرق التصحيح على النقدية الآن.')}</p>
      <div className="treasury-correction-fields">
        <label>
          {uiText('الحركة')}
          <select
            aria-label={uiText('الحركة الصحيحة')}
            value={direction}
            disabled={locked || busy}
            onChange={(event) => setDirection(event.target.value as 'in' | 'out')}
          >
            <option value="in">{uiText('دخول')}</option>
            <option value="out">{uiText('خروج')}</option>
          </select>
        </label>
        <label>
          {uiText('القيمة الصحيحة')}
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
        </label>
        <label>
          {uiText('البيان')}
          <input
            aria-label={uiText('البيان المصحح')}
            maxLength={500}
            value={description}
            disabled={locked || busy}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label>
          {uiText('سبب التصحيح')}
          <input
            aria-label={uiText('سبب التصحيح')}
            maxLength={500}
            required
            value={reason}
            disabled={locked || busy}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
      </div>
      <div className="treasury-correction-preview" aria-live="polite">
        <span>
          {uiText('قبل التصحيح: {0} — {1}', [
            money.format(effective.amountUnits),
            effective.direction === 'in' ? uiText('دخول') : uiText('خروج'),
          ])}
        </span>
        <strong>{uiText('فرق النقدية: {0}', [money.format(delta)])}</strong>
        <strong>{uiText('الرصيد المتوقع: {0}', [money.format(projected)])}</strong>
      </div>
      {locked && <p role="status">{uiText('لم يتأكد الحفظ. أعد محاولة نفس التصحيح دون تغيير بياناته.')}</p>}
      <div className="treasury-correction-actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (confirmLeave()) onCancel();
          }}
        >
          {uiText('إلغاء')}
        </button>
        <button type="submit" className="primary" disabled={busy || !valid}>
          {locked ? uiText('إعادة محاولة التأكيد') : uiText('اعتماد التصحيح')}
        </button>
      </div>
    </form>
  );
}
