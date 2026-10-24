import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../api.ts';
import type { ReportOverview } from '../../../shared/reportOverview.ts';
import { useSectionSnapshots } from '../../dashboard/sectionSnapshots.tsx';
import { useRealtimeRefresh } from '../../realtime/useRealtimeRefresh.ts';
import { uiText } from '../../i18n/language.ts';

export function useReportOverview() {
  const snapshots = useSectionSnapshots();
  const [data, setData] = useState<ReportOverview | null>(() => snapshots.get<ReportOverview>('reports-overview') ?? null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const sequence = useRef(0);
  const invalidate = useCallback(() => { sequence.current++; }, []);
  const load = useCallback(async () => {
    const request = ++sequence.current;
    const generation = snapshots.generation;
    setBusy(true);
    try {
      const next = await api.reportOverview();
      if (request !== sequence.current) return;
      setData(next); snapshots.set('reports-overview', next, generation); setMessage('');
    } catch (error) {
      if (request !== sequence.current) return;
      setMessage(error instanceof ApiError ? error.message : uiText('تعذر تحديث التقرير؛ البيانات المعروضة هي آخر قراءة ناجحة.'));
      throw error;
    } finally {
      if (request === sequence.current) setBusy(false);
    }
  }, [snapshots]);
  useEffect(() => {
    void load().catch(() => undefined);
    // Updates time/date boundaries even on an idle system. Financial events refresh sooner.
    const timer = window.setInterval(() => { if (!document.hidden) void load().catch(() => undefined); }, 60_000);
    return () => { invalidate(); window.clearInterval(timer); };
  }, [load, invalidate]);
  useRealtimeRefresh({
    initialSnapshotProvided: true, cursorKey: 'abdo:reports-overview-events', onChange: load,
    topics: ['financial.summary.changed', 'customer.changed', 'company.changed', 'libyan-deposit.changed', 'egyptian-deposit.changed',
      'collection.changed', 'treasury.changed', 'customer.ledger.changed', 'company.ledger.changed', 'libyan-deposit.ledger.changed',
      'egyptian-deposit.ledger.changed', 'purchases.changed', 'masraweya.changed', 'treasury.report.closed'],
  });
  return { data, busy, message, load };
}
