import { direction, uiText } from '../../i18n/language.ts';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Landmark, RefreshCw } from 'lucide-react';
import { api, ApiError, type TreasuryCashEntry, type TreasuryDashboard, type User } from '../../api.ts';
import { useRealtimeRefresh } from '../../realtime/useRealtimeRefresh.ts';
import { TreasuryCards } from './TreasuryCards.tsx';
import { TreasuryCashEntryForm, type TreasuryEntryMode } from './TreasuryCashEntryForm.tsx';
import { TreasuryCashLedger } from './TreasuryCashLedger.tsx';

const errorText = (error: unknown) => (error instanceof ApiError ? error.message : uiText("تعذر تنفيذ العملية."));

export function TreasurySection({ user }: { user: User }) {
  const canWrite = user.role === 'admin' || user.permissions?.includes('treasury.write') === true;
  const [dashboard, setDashboard] = useState<TreasuryDashboard | null>(null);
  const [entries, setEntries] = useState<TreasuryCashEntry[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [mode, setMode] = useState<TreasuryEntryMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [scrollRequest, setScrollRequest] = useState(0);
  const loadedEntries = useRef<TreasuryCashEntry[]>([]);
  const oldestCursor = useRef<number | null>(null);
  const submitting = useRef(false);
  const pendingRequestId = useRef<string | null>(null);

  const latestLoad = useRef(0);
  const load = useCallback(async (quiet = false) => {
    const request = ++latestLoad.current;
    if (!quiet) setBusy(true);
    try {
      const [summary, ledger] = await Promise.all([api.treasury(), api.treasuryCashLedger()]);
      if (request !== latestLoad.current) return;
      const preserveHistory = quiet && window.matchMedia('(min-width: 901px)').matches && loadedEntries.current.length > 0;
      if (preserveHistory) {
        // Bridge any gap after reconnecting before merging the retained history.
        const previousLatest = loadedEntries.current.at(-1)!.sequence;
        while (ledger.nextBefore !== null && ledger.items[0].sequence > previousLatest + 1) {
          const page = await api.treasuryCashLedger(ledger.nextBefore);
          if (request !== latestLoad.current) return;
          ledger.items = [...page.items, ...ledger.items];
          ledger.nextBefore = page.nextBefore;
        }
        const combined = new Map(loadedEntries.current.map((entry) => [entry.id, entry]));
        for (const entry of ledger.items) combined.set(entry.id, entry);
        ledger.items = [...combined.values()].sort((a, b) => a.sequence - b.sequence);
        ledger.nextBefore = oldestCursor.current;
      }
      loadedEntries.current = ledger.items;
      oldestCursor.current = ledger.nextBefore;
      setDashboard(summary);
      setEntries(ledger.items);
      setNextBefore(ledger.nextBefore);
    } catch (error) {
      if (quiet) throw error;
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
      'financial.summary.changed', 'customer.changed', 'company.changed', 'libyan-deposit.changed', 'egyptian-deposit.changed', 'collection.changed',
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
      if (submitting.current) throw new Error('Refresh deferred until cash submission finishes');
      return load(true);
    },
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dashboard || !mode || submitting.current) return;
    const data = new FormData(event.currentTarget);
    const amountUnits = Number(data.get('amountUnits'));
    if (!Number.isSafeInteger(amountUnits) || amountUnits <= 0) {
      setMessage(uiText("أدخل قيمة صحيحة موجبة."));
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
      setMessage(mode === 'in' ? uiText("تم اعتماد دخول النقدية.") : uiText("تم اعتماد خروج النقدية."));
      await load(true);
      setScrollRequest((value) => value + 1);
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
    const request = latestLoad.current;
    try {
      const olderPage = await api.treasuryCashLedger(nextBefore);
      if (request !== latestLoad.current) return;
      const combined = new Map([...olderPage.items, ...loadedEntries.current].map((entry) => [entry.id, entry]));
      loadedEntries.current = [...combined.values()].sort((a, b) => a.sequence - b.sequence);
      oldestCursor.current = olderPage.nextBefore;
      setEntries(loadedEntries.current);
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
        <div className="empty">{busy ? uiText("جارٍ تحميل الخزينة…") : message}</div>
      </section>
    );
  return (
    <section className="treasury-page" dir={direction}>
      <header className="treasury-head">
        <div>
          <h1>
            <Landmark size={21} />
            {uiText("الخزينة")}</h1>
          <p>{uiText("الإجماليات من الأقسام فقط — النقدية من سجل الدخول والخروج فقط")}</p>
        </div>
        <button
          className="icon-button"
          aria-label={uiText("تحديث الخزينة")}
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
            <h2>{uiText("سجل الفلوس النشطة")}</h2>
            <small>{uiText("سجل دائم مستقل عن معاملات العملاء والأقسام")}</small>
          </div>
          {canWrite && (
            <div className="treasury-cash-actions">
              <button className="cash-in" onClick={() => openEntry('in')}>
                <ArrowDownToLine size={15} />
                {uiText("دخول")}</button>
              <button className="cash-out" onClick={() => openEntry('out')}>
                <ArrowUpFromLine size={15} />
                {uiText("خروج")}</button>
            </div>
          )}
        </div>
        {mode && <TreasuryCashEntryForm mode={mode} busy={busy} onCancel={cancelEntry} onSubmit={submit} />}
        {nextBefore && (
          <button className="treasury-older" disabled={busy} onClick={() => void older()}>
            {uiText("تحميل حركات أقدم")}</button>
        )}
        <TreasuryCashLedger entries={entries} scrollRequest={scrollRequest} />
      </section>
    </section>
  );
}
