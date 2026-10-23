import { uiText } from '../../i18n/language.ts';
import { Check, X } from 'lucide-react';
import type { PurchaseEntry, PurchaseMerchantKey } from '../../api.ts';
import { PURCHASE_TYPES, purchaseNumber } from './purchaseEditorModel.ts';
import { usePurchaseEditor } from './usePurchaseEditor.ts';
import { purchasePreviewBalance } from './purchaseRunningBalance.ts';

type Props = {
  entry?: PurchaseEntry;
  dayVersion: number;
  balanceBeforeUnits: number | null;
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
  balanceBeforeUnits,
  busy,
  merchant,
  markDirty,
  cancel,
  saved,
  setBusy,
  setMessage,
}: Props) {
  const { draft, result, remaining, set, choose, commit, keys, confirmLeave } = usePurchaseEditor({
    entry,
    dayVersion,
    merchant,
    markDirty,
    saved,
    setBusy,
    setMessage,
  });

  const runningBalance = purchasePreviewBalance(balanceBeforeUnits, remaining);
  return (
    <div className="purchase-grid purchase-inline-editor">
      <span className="purchase-sequence">{entry ? entry.sequence : uiText("جديد")}</span>
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
            {uiText(label)}
          </button>
        ))}
        <input
          aria-label={uiText("نوع آخر")}
          value={draft.itemCode === 'custom' ? draft.itemLabel : ''}
          placeholder={uiText("آخر")}
          onChange={(event) => choose('custom', event.target.value)}
        />
      </span>
      <span>
        <input
          aria-label={uiText("القيمة ج.م")}
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
          aria-label={uiText("سعر الصرف")}
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
          aria-label={uiText("المسدد")}
          inputMode="numeric"
          value={draft.paid}
          onChange={(event) => set('paid', event.target.value)}
          onKeyDown={keys}
        />
      </span>
      <span className="calculated purchase-running-balance" dir="ltr" title={uiText('الرصيد التراكمي بعد المعاملة')}>
        {runningBalance === null ? '—' : purchaseNumber.format(runningBalance)}
      </span>
      <span>
        <input
          aria-label={uiText("مستهلك فودافون")}
          inputMode="numeric"
          value={draft.consumed}
          onChange={(event) => set('consumed', event.target.value)}
          onKeyDown={keys}
        />
      </span>
      <span className="purchase-actions">
        <button aria-label={uiText("اعتماد الصف")} disabled={busy} onClick={() => void commit()}>
          <Check size={14} />
        </button>
        {entry && (
          <button aria-label={uiText("إلغاء التعديل")} onClick={() => { if (confirmLeave()) cancel(); }}>
            <X size={14} />
          </button>
        )}
      </span>
    </div>
  );
}
