import { useRef, useState, type KeyboardEvent } from 'react';
import { api, type PurchaseEntry, type PurchaseMerchantKey } from '../../api.ts';
import {
  blankPurchaseDraft,
  choosePurchaseType,
  purchaseDraftError,
  purchaseDraftIsBlank,
  purchaseDraftFromEntry,
  purchaseDraftTotals,
  purchaseEntryInput,
  purchaseErrorText,
  updatePurchaseDraft,
  type PurchaseDraft,
} from './purchaseEditorModel.ts';

type UsePurchaseEditorOptions = {
  entry?: PurchaseEntry;
  dayVersion: number;
  merchant: PurchaseMerchantKey;
  markDirty: () => void;
  saved: () => Promise<void>;
  setBusy: (value: boolean) => void;
  setMessage: (value: string) => void;
};

export function usePurchaseEditor({
  entry,
  dayVersion,
  merchant,
  markDirty,
  saved,
  setBusy,
  setMessage,
}: UsePurchaseEditorOptions) {
  const [draft, setDraft] = useState<PurchaseDraft>(
    entry ? purchaseDraftFromEntry(entry) : blankPurchaseDraft(),
  );
  const saving = useRef(false);
  const requestId = useRef(crypto.randomUUID());

  function changed() {
    requestId.current = crypto.randomUUID();
    markDirty();
  }

  function set(field: keyof PurchaseDraft, value: string) {
    changed();
    setDraft((current) => updatePurchaseDraft(current, field, value));
  }

  function choose(itemCode: string, itemLabel: string) {
    changed();
    setDraft((current) => choosePurchaseType(current, itemCode, itemLabel));
  }

  async function commit() {
    if (saving.current) return false;
    if (purchaseDraftIsBlank(draft)) return false;
    const validationError = purchaseDraftError(draft);
    if (validationError) {
      setMessage(validationError);
      return false;
    }
    saving.current = true;
    setBusy(true);
    try {
      const body = purchaseEntryInput(draft, requestId.current, dayVersion);
      if (entry) await api.updatePurchase(merchant, entry.id, { ...body, expectedVersion: entry.version });
      else await api.createPurchase(merchant, body);
      requestId.current = crypto.randomUUID();
      setDraft(blankPurchaseDraft());
      await saved();
      setMessage(entry ? 'تم تعديل المعاملة في مكانها.' : 'تم الحفظ وفتح صف جديد.');
      return true;
    } catch (error) {
      setMessage(purchaseErrorText(error));
      return false;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  function keys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'Enter') return;
    event.preventDefault();
    void commit();
  }

  return { draft, ...purchaseDraftTotals(draft), set, choose, commit, keys };
}
