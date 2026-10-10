import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, FileText, RefreshCw, ShieldCheck } from 'lucide-react';
import { api, ApiError, type ReportsDashboard } from '../../api.ts';
import { useRealtimeRefresh } from '../../realtime/useRealtimeRefresh.ts';
import { money, netChange, statusText } from './reportViewModel.ts';

const errorText = (error: unknown) => error instanceof ApiError ? error.message : 'تعذر تحميل التقارير.';

export function ReportsSection() {
  const [data, setData] = useState<ReportsDashboard | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setBusy(true);
    try {
      setData(await api.reports(90));
      setMessage('');
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      if (!quiet) setBusy(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useRealtimeRefresh({
    topics: [
      'treasury.changed', 'customer.ledger.changed', 'company.ledger.changed',
      'libyan-deposit.ledger.changed', 'egyptian-deposit.ledger.changed',
      'purchases.changed', 'masraweya.changed',
    ],
    cursorKey: 'abdo:reports-last-event',
    onChange: () => load(true),
  });

  if (!data) return <section className="reports-page"><div className="empty">{busy ? 'جارٍ إعداد التقرير…' : message}</div></section>;
  const current = data.current;
  return (
    <section className="reports-page" dir="rtl">
      <header className="reports-head">
        <div><h1><FileText size={17} />التقارير الذكية</h1><p>سجل يومي تلقائي من إجماليات الخزينة</p></div>
        <button className="reports-refresh" title="تحديث بيانات التقرير الآن" aria-label="تحديث بيانات التقرير الآن" disabled={busy} onClick={() => void load()}><RefreshCw size={14} /></button>
      </header>
      {message && <div className="reports-message">{message}</div>}
      {current && (
        <section className={`report-today ${current.status}`}>
          <div className="report-today-icon">{current.status === 'normal' ? <ShieldCheck size={16} /> : <AlertTriangle size={16} />}</div>
          <small>اليوم <b dir="ltr">{current.businessDate}</b></small>
          <strong>{current.summary}</strong>
          <span className={`report-status ${current.status}`}>{statusText[current.status]}</span>
          <b className="report-today-net" dir="ltr">{money(current.netUnits)}</b>
        </section>
      )}
      <section className="reports-table-wrap" aria-label="السجل اليومي للتقارير">
        <table className="reports-table">
          <thead><tr><th>التسلسل</th><th>التاريخ</th><th>ديون لنا</th><th>الأموال النشطة</th><th>المصري</th><th>المصري بالليبي</th><th>ديون علينا</th><th>صافي الخزينة</th><th>الفرق عن اليوم السابق</th><th>الحالة</th><th>ملاحظة النظام</th></tr></thead>
          <tbody>{data.items.map((item, index) => {
            const change = netChange(data.items, index);
            return <tr className={`report-row ${item.status}`} key={item.businessDate}>
              <td data-label="التسلسل"><b dir="ltr">{item.sequence}</b></td>
              <td data-label="التاريخ"><b dir="ltr">{item.businessDate}</b></td>
              <td data-label="ديون لنا" dir="ltr">{money(item.receivablesUnits)}</td>
              <td data-label="الأموال النشطة" dir="ltr">{money(item.activeCashUnits)}</td>
              <td data-label="المصري" dir="ltr">{money(item.egyptianSourceUnits, 'ج.م')}</td>
              <td data-label="المصري بالليبي" dir="ltr">{money(item.egyptianConvertedUnits)}</td>
              <td data-label="ديون علينا" dir="ltr">{money(item.liabilitiesUnits)}</td>
              <td data-label="صافي الخزينة" className="report-net" dir="ltr">{money(item.netUnits)}</td>
              <td data-label="الفرق اليومي" className={change !== null && change < 0 ? 'negative' : 'positive'} dir="ltr">{change === null ? '—' : `${change > 0 ? '+' : ''}${money(change)}`}</td>
              <td data-label="الحالة"><span className={`report-status ${item.status}`}>{statusText[item.status]}</span></td>
              <td data-label="ملاحظة النظام" className="report-note"><span>{item.summary}</span>{item.reasons.length > 0 && <small>{item.reasons.slice(0, 2).map((reason) => reason.label).join(' • ')}</small>}</td>
            </tr>;
          })}</tbody>
        </table>
      </section>
      <footer className="reports-method"><strong>المعادلة:</strong> {data.methodology.formula}<span>{data.methodology.note}</span></footer>
    </section>
  );
}
