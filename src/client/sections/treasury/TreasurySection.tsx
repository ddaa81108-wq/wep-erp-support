import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Landmark, RefreshCw } from 'lucide-react';
import { api, ApiError, type TreasuryCashEntry, type TreasuryDashboard, type User } from '../../api.ts';
import { useRealtimeRefresh } from '../../realtime/useRealtimeRefresh.ts';
import { TreasuryCards } from './TreasuryCards.tsx';
import { TreasuryCashEntryForm, type TreasuryEntryMode } from './TreasuryCashEntryForm.tsx';
import { TreasuryCashLedger } from './TreasuryCashLedger.tsx';

const errorText = (error: unknown) => (error instanceof ApiError ? error.message : 'تعذر تنفيذ العملية.');

export function TreasurySection({ user }: { user: User }) {
  const canWrite = user.role === 'admin' || user.permissions?.includes('treasury.write') === true;
  const [dashboard, setDashboard] = useState<TreasuryDashboard | null>(null);
  const [entries, setEntries] = useState<TreasuryCashEntry[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [mode, setMode] = useState<TreasuryEntryMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const submitting = useRef(false);
  const pendingRequestId = useRef<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setBusy(true);
    try {
      const [summary, ledger] = await Promise.all([api.treasury(), api.treasuryCashLedger()]);
      setDashboard(summary);
      setEntries(ledger.items);
      setNextBefore(ledger.nextBefore);
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      if (!quiet) setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useRealtimeRefresh({
    topics: [
      'treasury.changed',
      'customer.ledger.changed',
      'company.ledger.changed',
      'libyan-deposit.ledger.changed',
      'egyptian-deposit.ledger.changed',
      'purchases.changed',
      'masraweya.changed',
    ],
    cursorKey: 'abdo:treasury-last-event',
    onChange: () => {
      if (!submitting.current && mode === null) return load(true);
    },
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dashboard || !mode || submitting.current) return;
    const data = new FormData(event.currentTarget);
    const amountUnits = Number(data.get('amountUnits'));
    if (!Number.isSafeInteger(amountUnits) || amountUnits <= 0) {
      setMessage('أدخل قيمة صحيحة موجبة.');
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      await api.addTreasuryCashEntry({
        requestId: pendingRequestId.current ?? crypto.randomUUID(),
        expectedVersion: dashboard.cashVersion,
        direction: mode,
        amountUnits,
        description: String(data.get('description') ?? ''),
      });
      pendingRequestId.current = null;
      setMode(null);
      setMessage(mode === 'in' ? 'تم اعتماد دخول النقدية.' : 'تم اعتماد خروج النقدية.');
      await load(true);
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  function openEntry(direction: TreasuryEntryMode) {
    pendingRequestId.current = crypto.randomUUID();
    setMode(direction);
    setMessage('');
  }

  function cancelEntry() {
    pendingRequestId.current = null;
    setMode(null);
  }

  async function older() {
    if (!nextBefore || busy) return;
    setBusy(true);
    try {
      const olderPage = await api.treasuryCashLedger(nextBefore);
      setEntries((current) => [...olderPage.items, ...current]);
      setNextBefore(olderPage.nextBefore);
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  if (!dashboard)
    return (
      <section className="treasury-page">
        <div className="empty">{busy ? 'جارٍ تحميل الخزينة…' : message}</div>
      </section>
    );
  return (
    <section className="treasury-page" dir="rtl">
      <header className="treasury-head">
        <div>
          <h1>
            <Landmark size={21} />
            الخزينة
          </h1>
          <p>الإجماليات من الأقسام فقط — النقدية من سجل الدخول والخروج فقط</p>
        </div>
        <button
          className="icon-button"
          aria-label="تحديث الخزينة"
          disabled={busy}
          onClick={() => void load()}
        >
          <RefreshCw size={16} />
        </button>
      </header>
      {message && <div className="treasury-message">{message}</div>}
      <TreasuryCards dashboard={dashboard} />
      <section className="treasury-cash-panel">
        <div className="treasury-panel-head">
          <div>
            <h2>سجل الفلوس النشطة</h2>
            <small>سجل دائم مستقل عن معاملات العملاء والأقسام</small>
          </div>
          {canWrite && (
            <div className="treasury-cash-actions">
              <button className="cash-in" onClick={() => openEntry('in')}>
                <ArrowDownToLine size={15} />
                دخول
              </button>
              <button className="cash-out" onClick={() => openEntry('out')}>
                <ArrowUpFromLine size={15} />
                خروج
              </button>
            </div>
          )}
        </div>
        {mode && <TreasuryCashEntryForm mode={mode} busy={busy} onCancel={cancelEntry} onSubmit={submit} />}
        {nextBefore && (
          <button className="treasury-older" onClick={() => void older()}>
            تحميل حركات أقدم
          </button>
        )}
        <TreasuryCashLedger entries={entries} />
      </section>
    </section>
  );
}
