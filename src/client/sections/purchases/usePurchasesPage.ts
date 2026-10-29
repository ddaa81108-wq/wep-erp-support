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
  const currentDayId = useRef<string | null>(null);
  const entryCache=useRef<PurchaseEntry[]>([]);
  const loadedPages=useRef(1);
  useEffect(()=>{entryCache.current=entries;},[entries]);
  const dirtyEntryIds = useRef(new Set<string>());
  const deleteRequestIds = useRef(new Map<string, string>());
  const finalizeRequestId = useRef<string | null>(null);

  const latestLoad = useRef(0);
  const load = useCallback(async (key: PurchaseMerchantKey, quiet = false, background = false) => {
    const request = ++latestLoad.current;
    if (!quiet) setBusy(true);
    try {
      const cached=entryCache.current;
      const byId=new Map(cached.map(entry=>[entry.id,entry]));
      const readPage=async(before:number|null,index:number)=>{
        const knownEntries=background?cached.slice(Math.max(0,cached.length-(index+1)*100),cached.length-index*100):[];
        const tags=knownEntries.map(entry=>entry.viewTag).filter((tag):tag is string=>Boolean(tag));
        let result=await api.purchases(key,before,tags.length&&tags.length===knownEntries.length?tags:undefined);
        if(result.orderedEntryIds){
          for(const entry of result.entries)byId.set(entry.id,entry);
          if(result.orderedEntryIds.some(id=>!byId.has(id)||!result.entryDays?.[byId.get(id)!.dayId]))result=await api.purchases(key,before);
          else result={...result,entries:result.orderedEntryIds.map(id=>{const entry=byId.get(id)!;return {...entry,...result.entryDays![entry.dayId]};})};
        }
        return result;
      };
      let next = await readPage(null,0);
      for(let index=1;background&&index<loadedPages.current&&next.nextBefore;index++){
        const older=await readPage(next.nextBefore,index);
        next={...next,entries:[...older.entries,...next.entries],nextBefore:older.nextBefore};
      }
      if (request !== latestLoad.current) return;
      // Same-day saved rows and totals can update independently of editor state.
      // A remote day rollover must not remount and discard an unsaved draft.
      if (background && dirty.current && currentDayId.current !== next.day.id)
        throw new Error('Day rollover deferred while a purchase draft is being edited');
      if (background && [...dirtyEntryIds.current].some(id => {
        const entry = next.entries.find(item => item.id === id);
        return !entry || entry.dayStatus === 'finalized' && !entry.correctionOpen;
      })) throw new Error('An edited purchase row was removed or locked remotely');
      setPage(next);
      setEntries(next.entries);
      loadedPages.current=Math.max(1,Math.ceil(next.entries.length/100));
      currentDayId.current = next.day.id;
      if (!background) { dirty.current = false; dirtyEntryIds.current.clear(); }
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
    onChange: () => load(merchant, true, true),
  });

  function markDirty(entryId?: string) {
    dirty.current = true;
    if (entryId) dirtyEntryIds.current.add(entryId);
  }

  function cancelEditing() {
    setEditingId(null);
    dirty.current = false;
    dirtyEntryIds.current.clear();
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
      loadedPages.current++;
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
