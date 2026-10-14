import { Check, X } from 'lucide-react';
import type { PurchaseEntry, PurchaseMerchantKey } from '../../api.ts';
import { PURCHASE_TYPES, purchaseNumber } from './purchaseEditorModel.ts';
import { usePurchaseEditor } from './usePurchaseEditor.ts';

type Props = {
  entry?: PurchaseEntry;
  dayVersion: number;
  busy: boolean;
  merchant: PurchaseMerchantKey;
  markDirty: () => void;
  cancel: () => void;
  saved: () => Promise<void>;
  setBusy: (value: boolean) => void;
  setMessage: (value: string) => void;
};

export function PurchaseInlineEditor({
  entry,
  dayVersion,
  busy,
  merchant,
  markDirty,
  cancel,
  saved,
  setBusy,
  setMessage,
}: Props) {
  const { draft, result, remaining, set, choose, commit, keys } = usePurchaseEditor({
    entry,
    dayVersion,
    merchant,
    markDirty,
    saved,
    setBusy,
    setMessage,
  });

  return (
    <div className="purchase-grid purchase-inline-editor">
      <span className="purchase-sequence">{entry ? entry.sequence : 'جديد'}</span>
      <span className="inline-types">
        {PURCHASE_TYPES.map(([code, label]) => (
          <button
            type="button"
            key={code}
            data-kind={code}
            aria-pressed={draft.itemCode === code}
            className={draft.itemCode === code ? 'active' : ''}
            onClick={() => choose(code, code === 'vodafone_cash' ? 'فودافون كاش' : label)}
          >
            {label}
          </button>
        ))}
        <input
          aria-label="نوع آخر"
          value={draft.itemCode === 'custom' ? draft.itemLabel : ''}
          placeholder="آخر"
          onChange={(event) => choose('custom', event.target.value)}
        />
      </span>
      <span>
        <input
          aria-label="القيمة ج.م"
          data-new-value={!entry || undefined}
          inputMode="numeric"
          value={draft.value}
          onChange={(event) => set('value', event.target.value)}
          onKeyDown={keys}
        />
      </span>
      <span className="operation-buttons">
        <button
          type="button"
          className={draft.mode === 'multiply' ? 'active' : ''}
          data-mode="multiply"
          aria-pressed={draft.mode === 'multiply'}
          onClick={() => set('mode', 'multiply')}
        >
          ×
        </button>
        <button
          type="button"
          className={draft.mode === 'divide' ? 'active' : ''}
          data-mode="divide"
          aria-pressed={draft.mode === 'divide'}
          onClick={() => set('mode', 'divide')}
        >
          ÷
        </button>
      </span>
      <span>
        <input
          aria-label="سعر الصرف"
          inputMode="decimal"
          value={draft.rate}
          onChange={(event) => set('rate', event.target.value)}
          onKeyDown={keys}
        />
      </span>
      <span className="calculated" dir="ltr">
        {purchaseNumber.format(result)}
      </span>
      <span>
        <input
          aria-label="المسدد"
          inputMode="numeric"
          value={draft.paid}
          onChange={(event) => set('paid', event.target.value)}
          onKeyDown={keys}
        />
      </span>
      <span className="calculated" dir="ltr">
        {purchaseNumber.format(remaining)}
      </span>
      <span>
        <input
          aria-label="مستهلك فودافون"
          inputMode="numeric"
          value={draft.consumed}
          onChange={(event) => set('consumed', event.target.value)}
          onKeyDown={keys}
        />
      </span>
      <span className="purchase-actions">
        <button aria-label="اعتماد الصف" disabled={busy} onClick={() => void commit()}>
          <Check size={14} />
        </button>
        {entry && (
          <button aria-label="إلغاء التعديل" onClick={cancel}>
            <X size={14} />
          </button>
        )}
      </span>
    </div>
  );
}
