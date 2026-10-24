import { useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';
import type { ReportClosing, ReportClosingHistory, ReportOverview } from '../../../shared/reportOverview.ts';
import { api } from '../../api.ts';
import { uiText } from '../../i18n/language.ts';
import { money, reportNumber } from './reportViewModel.ts';
import { ClosingJournal } from './ClosingJournal.tsx';

const compactMoney = (value: number | null) => value === null ? '—' : reportNumber.format(value);
const difference = (value: number | null | undefined) => value === null || value === undefined ? '—' : `${value > 0 ? '+' : ''}${reportNumber.format(value)}`;

function ClosingRows({ items, onSelect }: { items: ReportClosing[]; onSelect: (closing: ReportClosing) => void }) {
  return <div className="closing-comparison-table"><table><thead><tr><th>{uiText('يوم العمل')}</th><th>{uiText('صافي 05:00')}</th><th>{uiText('الفرق')}</th><th>{uiText('تفاصيل')}</th></tr></thead>
    <tbody>{items.map(item => <tr key={item.businessDate} data-testid="closing-history-row">
      <td><time dir="ltr">{item.businessDate}</time></td><td dir="ltr">{compactMoney(item.netUnits)}</td>
      <td dir="ltr" className={item.changeUnits !== null && item.changeUnits < 0 ? 'closing-down' : 'closing-up'}>{difference(item.changeUnits)}</td>
      <td><button aria-label={uiText('تفاصيل لقطة {0}', [item.businessDate])} onClick={() => onSelect(item)}>{uiText('فتح')}</button></td>
    </tr>)}</tbody></table></div>;
}

function OlderClosings({ before, onSelect }: { before: string; onSelect: (closing: ReportClosing) => void }) {
  const [history, setHistory] = useState<ReportClosingHistory | null>(null);
  const [items, setItems] = useState<ReportClosing[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setBusy(true); setError('');
    void api.reportClosingHistory(before).then(next => { if (active) { setItems(next.items); setHistory(next); } })
      .catch(() => { if (active) setError(uiText('تعذر تحميل اللقطات الأقدم.')); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [before]);
  async function more() {
    if (!history?.nextBefore || busy) return;
    setBusy(true); setError('');
    try {
      const next = await api.reportClosingHistory(history.nextBefore);
      setItems(previous => [...previous, ...next.items]); setHistory(next);
    } catch { setError(uiText('تعذر تحميل اللقطات الأقدم.')); }
    finally { setBusy(false); }
  }
  return <>{error && <p role="alert">{error}</p>}<ClosingRows items={items} onSelect={onSelect} />
    {busy && <p role="status">{uiText('جارٍ تحميل التفاصيل…')}</p>}
    {history?.hasMore && <button className="closing-more" disabled={busy} onClick={() => void more()}>{uiText('تحميل 20 لقطة أقدم')}</button>}</>;
}

export function ReportClosingPanel({ data, canViewJournal }: { data: ReportOverview; canViewJournal: boolean }) {
  const [selected, setSelected] = useState<ReportClosing | null>(null);
  const [olderOpen, setOlderOpen] = useState(false);
  const closing = data.latestClosing;
  const available = closing.state === 'recorded' || closing.state === 'missing_rate';
  const stateText = closing.state === 'recorded' ? 'لقطة محفوظة وثابتة'
    : closing.state === 'pending' ? 'بانتظار موعد الخامسة صباحًا.'
      : closing.state === 'missed' ? 'لم تُسجّل اللقطة في موعدها؛ لن نختلق رقمًا بأثر رجعي.' : 'اللقطة غير مكتملة؛ سعر التحويل كان مفقودًا.';
  return <section className="report-block report-closings report-closing-compact" aria-label={uiText('صافي الخامسة صباحًا')}>
    <header className="closing-compact-head"><div><Clock3 size={17} /><h2>{uiText('مقارنة الخامسة صباحًا')}</h2></div><span>{uiText('بتوقيت ليبيا · د.ل')}</span></header>
    <div className="closing-compact-current">
      <span><time dir="ltr">{closing.businessDate}</time><small data-testid="latest-report-closing">{uiText(stateText)}</small></span>
      <span>{uiText('الصافي')}<b data-testid="report-closing-net" dir="ltr">{money(available ? closing.netUnits : null)}</b></span>
    </div>
    <p className="closing-table-caption">{uiText('آخر 20 لقطة مسجلة أمامك؛ الفرق عن آخر لقطة سابقة، دون إنشاء أيام مفقودة.')}</p>
    <div className="closing-visible-history"><ClosingRows items={data.closings} onSelect={setSelected} /></div>
    {!data.closings.length && <p className="report-empty">{uiText('لا توجد لقطات خامسة صباحًا محفوظة بعد.')}</p>}
    {data.closingsHasMore && <details className="report-closing-archive" onToggle={event => setOlderOpen(event.currentTarget.open)}>
      <summary>{uiText('إظهار الأقدم من 20 لقطة')}</summary>
      {olderOpen && <OlderClosings before={data.closings.at(-1)!.businessDate} onSelect={setSelected} />}
    </details>}
    <p className="closing-table-caption">{uiText('المقارنة لصافي الخامسة فقط؛ النقد محسوب ضمن الصافي. اللقطات ثابتة، والتسجيل يتطلب تشغيل السيرفر عند الخامسة.')}</p>
    {selected && <ClosingJournal closing={selected} canViewJournal={canViewJournal} onClose={() => setSelected(null)} />}
  </section>;
}
