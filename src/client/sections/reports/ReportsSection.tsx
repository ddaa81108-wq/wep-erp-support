import { direction, uiText, displayLocale } from '../../i18n/language.ts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, FileText, RefreshCw, ShieldCheck } from 'lucide-react';
import { api, ApiError, type ReportsDashboard } from '../../api.ts';
import { useRealtimeRefresh } from '../../realtime/useRealtimeRefresh.ts';
import { closingText, money, netChange, reportSummary, statusText } from './reportViewModel.ts';

const errorText = (error: unknown) => error instanceof ApiError ? error.message : uiText("تعذر تحميل التقارير.");

export function ReportsSection() {
  const [data, setData] = useState<ReportsDashboard | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const latestLoad = useRef(0);
  const load = useCallback(async (quiet = false) => {
    const request = ++latestLoad.current;
    if (!quiet) setBusy(true);
    try {
      const next = await api.reports(90);
      if (request !== latestLoad.current) return;
      setData(next);
      setMessage('');
    } catch (error) {
      if (quiet) throw error;
      setMessage(errorText(error));
    } finally {
      if (!quiet) setBusy(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const deadlines = data?.items.filter(item => item.fiveAmClosing?.state === 'pending')
      .map(item => Date.parse(item.fiveAmClosing.scheduledAt) + 60_000) ?? [];
    if (!deadlines.length) return;
    // Refresh time-based pending/missed labels even when there are no financial events.
    const timer = window.setTimeout(() => { void load(true).catch(() => undefined); },
      Math.max(60_000, Math.min(...deadlines) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [data, load]);
  useRealtimeRefresh({
    topics: [
      'financial.summary.changed', 'customer.changed', 'company.changed', 'libyan-deposit.changed', 'egyptian-deposit.changed', 'collection.changed',
      'treasury.changed', 'customer.ledger.changed', 'company.ledger.changed',
      'libyan-deposit.ledger.changed', 'egyptian-deposit.ledger.changed',
      'purchases.changed', 'masraweya.changed', 'treasury.report.closed',
    ],
    cursorKey: 'abdo:reports-last-event',
    onChange: () => load(true),
  });

  if (!data) return <section className="reports-page"><div className="empty">{busy ? uiText("جارٍ إعداد التقرير…") : message}</div></section>;
  const current = data.current;
  return (
    <section className="reports-page" dir={direction}>
      <header className="reports-head">
        <div><h1><FileText size={17} />{uiText("التقارير الذكية")}</h1><p>{uiText("سجل يومي تلقائي من إجماليات الخزينة")}</p></div>
        <button className="reports-refresh" title={uiText("تحديث بيانات التقرير الآن")} aria-label={uiText("تحديث بيانات التقرير الآن")} disabled={busy} onClick={() => void load()}><RefreshCw size={14} /></button>
      </header>
      {message && <div className="reports-message">{message}</div>}
      {current && (
        <section className={`report-today ${current.status}`}>
          <div className="report-today-icon">{current.status === 'normal' ? <ShieldCheck size={16} /> : <AlertTriangle size={16} />}</div>
          <small>{uiText("اليوم ")}<b dir="ltr">{current.businessDate}</b></small>
          <strong>{current.summary}</strong>
          <span className={`report-status ${current.status}`}>{statusText[current.status]}</span>
          <b className="report-today-net" dir="ltr">{money(current.netUnits)}</b>
        </section>
      )}
      <section className="reports-table-wrap" aria-label={uiText("السجل اليومي للتقارير")}>
        <table className="reports-table">
          <thead><tr><th>{uiText("التسلسل")}</th><th>{uiText("التاريخ")}</th><th>{uiText("ديون لنا")}</th><th>{uiText("الأموال النشطة")}</th><th>{uiText("المصري")}</th><th>{uiText("المصري بالليبي")}</th><th>{uiText("ديون علينا")}</th><th>{uiText("صافي الخزينة")}</th><th>{uiText("الفرق عن اليوم السابق")}</th><th>{uiText("الحالة")}</th><th>{uiText("ملاحظة النظام")}</th><th>{uiText("صافي الإقفال — 5 صباحًا")}</th></tr></thead>
          <tbody>{data.items.map((item, index) => {
            const change = netChange(data.items, index);
            return <tr className={`report-row ${item.status}`} key={item.businessDate}>
              <td data-label={uiText("التسلسل")}><b dir="ltr">{item.sequence}</b></td>
              <td data-label={uiText("التاريخ")}><b dir="ltr">{item.businessDate}</b></td>
              <td data-label={uiText("ديون لنا")} dir="ltr">{money(item.receivablesUnits)}</td>
              <td data-label={uiText("الأموال النشطة")} dir="ltr">{money(item.activeCashUnits)}</td>
              <td data-label={uiText("المصري")} dir="ltr">{money(item.egyptianSourceUnits, uiText("ج.م"))}</td>
              <td data-label={uiText("المصري بالليبي")} dir="ltr">{money(item.egyptianConvertedUnits)}</td>
              <td data-label={uiText("ديون علينا")} dir="ltr">{money(item.liabilitiesUnits)}</td>
              <td data-label={uiText("صافي الخزينة")} className="report-net" dir="ltr">{money(item.netUnits)}</td>
              <td data-label={uiText("الفرق اليومي")} className={change !== null && change < 0 ? 'negative' : 'positive'} dir="ltr">{change === null ? '—' : `${change > 0 ? '+' : ''}${money(change)}`}</td>
              <td data-label={uiText("الحالة")}><span className={`report-status ${item.status}`}>{statusText[item.status]}</span></td>
              <td data-label={uiText("ملاحظة النظام")} className="report-note"><span>{reportSummary(item)}</span>{item.reasons.length > 0 && <small>{item.reasons.slice(0, 2).map((reason) => uiText(reason.label)).join(' • ')}</small>}</td>
              <td data-label={uiText("صافي الإقفال — 5 صباحًا")} className={`report-closing ${item.fiveAmClosing?.netUnits !== null && (item.fiveAmClosing?.netUnits ?? 0) < 0 ? 'negative' : ''}`}>
                <strong>{closingText(item.fiveAmClosing)}</strong>
                {item.fiveAmClosing?.capturedAt && <small>{uiText("سُجّل ")}{new Intl.DateTimeFormat(displayLocale, { timeZone: 'Africa/Tripoli', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(item.fiveAmClosing.capturedAt))}</small>}
              </td>
            </tr>;
          })}</tbody>
        </table>
      </section>
      <footer className="reports-method"><strong>{uiText("المعادلة:")}</strong> {uiText(data.methodology.formula)}<span>{uiText(data.methodology.note)}</span></footer>
      <p className="reports-closing-method">{uiText("صافي الإقفال لقطة ثابتة قرابة 5:00 صباحًا بتوقيت ليبيا، تُنسب إلى يوم العمل السابق. الأيام التي لم يُسجّل إقفالها لا يُنشأ لها رقم بأثر رجعي.")}</p>
    </section>
  );
}
