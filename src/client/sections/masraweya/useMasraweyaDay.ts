import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError, type MasraweyaDay } from '../../api.ts';
import { useRealtimeRefresh } from '../../realtime/useRealtimeRefresh.ts';
import {
  blankMasraweyaRows,
  englishInteger,
  masraweyaTotals,
  numberValue,
  type MasraweyaEntryDraft,
} from './masraweyaModel.ts';

export function useMasraweyaDay(canWrite: boolean) {
  const [day, setDay] = useState<MasraweyaDay | null>(null);
  const [date, setDate] = useState('');
  const [rows, setRows] = useState<MasraweyaEntryDraft[]>(blankMasraweyaRows);
  const [previous, setPrevious] = useState('0');
  const [purchases, setPurchases] = useState('0');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const hydrate = useCallback((next: MasraweyaDay) => {
    setDay(next);
    setDate(next.businessDate);
    setPrevious(String(next.previousValueUnits));
    setPurchases(String(next.purchasesUnits));
    setRows(
      next.entries.length
        ? next.entries.map((entry) => ({
            value: String(entry.valueUnits),
            commission: String(entry.commissionUnits),
          }))
        : blankMasraweyaRows(),
    );
    setDirty(false);
  }, []);

  const load = useCallback(
    async (requestedDate?: string) => {
      setBusy(true);
      setMessage('');
      try {
        hydrate(await api.masraweyaDay(requestedDate));
      } catch (error) {
        setMessage(error instanceof ApiError ? error.message : 'تعذر تحميل صفحة المصراوية.');
      } finally {
        setBusy(false);
      }
    },
    [hydrate],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeRefresh({
    topics: ['masraweya.changed'],
    cursorKey: 'abdo:masraweya-last-event',
    enabled: Boolean(day),
    onChange: async () => {
      if (!dirty && day) hydrate(await api.masraweyaDay(day.businessDate));
    },
  });

  const totals = useMemo(
    () => masraweyaTotals(rows, previous, purchases),
    [previous, purchases, rows],
  );
  const locked = day?.status === 'finalized' && !day.correctionOpen || !canWrite;

  function changeDate(next: string) {
    setDate(next);
    if (next) void load(next);
  }

  function appendRow() {
    setRows((current) => [...current, { value: '', commission: '' }]);
  }

  function editRow(index: number, field: keyof MasraweyaEntryDraft, value: string) {
    setRows((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: englishInteger(value) } : row)),
    );
    setDirty(true);
  }

  function editPrevious(value: string) {
    setPrevious(englishInteger(value) || '0');
    setDirty(true);
  }

  function editPurchases(value: string) {
    setPurchases(englishInteger(value) || '0');
    setDirty(true);
  }

  const save = useCallback(async () => {
    if (!day) return null;
    setBusy(true);
    setMessage('');
    try {
      const next = await api.saveMasraweyaDay({
        businessDate: day.businessDate,
        expectedVersion: day.version,
        previousValueUnits: numberValue(previous),
        purchasesUnits: numberValue(purchases),
        entries: rows.map((row) => ({
          valueUnits: numberValue(row.value),
          commissionUnits: numberValue(row.commission),
        })),
      });
      hydrate(next);
      setMessage('تم حفظ اليوم بنجاح.');
      return next;
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'تعذر حفظ اليوم.');
      return null;
    } finally {
      setBusy(false);
    }
  }, [day, previous, purchases, rows, hydrate]);

  useEffect(() => {
    if (!dirty || locked || busy) return undefined;
    const timer = window.setTimeout(() => { void save(); }, 700);
    return () => window.clearTimeout(timer);
  }, [busy, dirty, locked, save]);

  async function finalize() {
    if (!day || !window.confirm('هل تريد اعتماد هذا اليوم؟ بعد الاعتماد لن يمكن تعديل صفوفه.')) return;
    const saved = dirty ? await save() : day;
    if (!saved) return;
    setBusy(true);
    try {
      hydrate(await api.finalizeMasraweyaDay(saved.businessDate, saved.version));
      setMessage('تم اعتماد اليوم، ويمكن ترحيل نتيجته يدويًا في اليوم التالي.');
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'تعذر اعتماد اليوم.');
    } finally {
      setBusy(false);
    }
  }

  async function setCorrection(open: boolean, reason = '') {
    if (!day) return;
    setBusy(true);
    setMessage('');
    try {
      hydrate(await api.setMasraweyaDayCorrection({
        businessDate: day.businessDate, expectedVersion: day.version, open, reason,
      }));
      setMessage(open ? 'تم فتح اليوم للتعديل.' : 'تم إغلاق التعديل، ويمكن اعتماده الآن.');
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'تعذر تغيير حالة التعديل.');
    } finally { setBusy(false); }
  }

  function applyCarry() {
    if (!day?.carrySourceDate || day.carryValueUnits === null) return;
    setPrevious(String(day.carryValueUnits));
    setDirty(true);
    setMessage(`تم تجهيز ترحيل ناتج ${day.carrySourceDate}. اضغط حفظ لتأكيده.`);
  }

  return {
    day,
    date,
    rows,
    previous,
    purchases,
    dirty,
    busy,
    message,
    locked,
    ...totals,
    changeDate,
    appendRow,
    editRow,
    editPrevious,
    editPurchases,
    save,
    finalize,
    setCorrection,
    applyCarry,
    setBusy,
    setMessage,
  };
}
