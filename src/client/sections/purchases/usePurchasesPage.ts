import { uiText } from '../../i18n/language.ts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type PurchaseEntry, type PurchaseMerchantKey, type PurchasesPage } from '../../api.ts';
import { useRealtimeRefresh } from '../../realtime/useRealtimeRefresh.ts';
import { purchaseErrorText } from './purchaseEditorModel.ts';
import { flushBeforeNavigation } from '../../dashboard/navigationGuards.ts';

export function usePurchasesPage() {
  const [merchant, setMerchant] = useState<PurchaseMerchantKey>('al_bayan');
  const [page, setPage] = useState<PurchasesPage | null>(null);
  const [entries, setEntries] = useState<PurchaseEntry[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const dirty = useRef(false);
  const deleteRequestIds = useRef(new Map<string, string>());
  const finalizeRequestId = useRef<string | null>(null);

  const latestLoad = useRef(0);
  const load = useCallback(async (key: PurchaseMerchantKey, quiet = false, background = false) => {
    const request = ++latestLoad.current;
    if (!quiet) setBusy(true);
    try {
      const next = await api.purchases(key);
      if (request !== latestLoad.current) return;
      if (background && dirty.current) throw new Error('Refresh deferred while editing');
      setPage(next);
      setEntries(next.entries);
      dirty.current = false;
    } catch (error) {
      if (quiet) throw error;
      setMessage(purchaseErrorText(error));
    } finally {
      if (!quiet) setBusy(false);
    }
  }, []);

  useEffect(() => {
    setEditingId(null);
    void load(merchant);
  }, [merchant, load]);
  useRealtimeRefresh({
    enabled: Boolean(page),
    initialSnapshotProvided: true,
    topics: ['purchases.changed'],
    cursorKey: 'abdo:purchases-last-event',
    onChange: () => {
      if (dirty.current) throw new Error('Refresh deferred while a purchase draft is being edited');
      return load(merchant, true, true);
    },
  });

  function markDirty() {
    dirty.current = true;
  }

  function cancelEditing() {
    setEditingId(null);
    dirty.current = false;
  }

  async function remove(entry: PurchaseEntry) {
    if (!confirm(uiText("حذف المعاملة رقم {0}؟", [entry.sequence]))) return;
    const requestId = deleteRequestIds.current.get(entry.id) ?? crypto.randomUUID();
    deleteRequestIds.current.set(entry.id, requestId);
    setBusy(true);
    try {
      await api.deletePurchase(merchant, entry.id, {
        requestId,
        expectedVersion: entry.version,
        expectedDayVersion: entry.dayVersion,
      });
      deleteRequestIds.current.delete(entry.id);
      await load(merchant, true);
      setMessage(uiText("تم حذف المعاملة وإعادة حساب الأيام التالية."));
    } catch (error) {
      setMessage(purchaseErrorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function finalize() {
    if (!(await flushBeforeNavigation())) return;
    if (!page || !confirm(uiText("ترحيل اليوم سيحوّل معاملاته إلى قراءة فقط. هل تريد المتابعة؟"))) return;
    const requestId = finalizeRequestId.current ?? crypto.randomUUID();
    finalizeRequestId.current = requestId;
    setBusy(true);
    try {
      await api.finalizePurchaseDay(merchant, { requestId, expectedDayVersion: page.day.version });
      finalizeRequestId.current = null;
      await load(merchant, true);
      setMessage(uiText("تم ترحيل اليوم وفتح يوم جديد."));
    } catch (error) {
      setMessage(purchaseErrorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function toggleCorrection(entry: PurchaseEntry, open: boolean) {
    setBusy(true);
    try {
      await api.setPurchaseDayCorrection(merchant, entry.dayId, { open, expectedVersion: entry.dayVersion });
      setEditingId(null);
      await load(merchant, true);
      setMessage(open ? uiText("فُتح اليوم كاملًا للتعديل.") : uiText("تم إنهاء تعديل اليوم وإغلاقه."));
    } catch (error) {
      setMessage(purchaseErrorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function older() {
    if (!page?.nextBefore) return;
    setBusy(true);
    try {
      const old = await api.purchases(merchant, page.nextBefore);
      setEntries((current) => [...old.entries, ...current]);
      setPage((current) => (current ? { ...current, nextBefore: old.nextBefore } : current));
    } catch (error) {
      setMessage(purchaseErrorText(error));
    } finally {
      setBusy(false);
    }
  }

  return {
    merchant,
    setMerchant: async (next: PurchaseMerchantKey) => {
      if (next !== merchant && await flushBeforeNavigation()) setMerchant(next);
    },
    page,
    entries,
    editingId,
    setEditingId,
    busy,
    setBusy,
    message,
    setMessage,
    load,
    markDirty,
    cancelEditing,
    remove,
    finalize,
    toggleCorrection,
    older,
  };
}
