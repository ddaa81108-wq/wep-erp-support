import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.ts';
import { Modal } from '../../components/Modal.tsx';
import { uiText, displayLocale } from '../../i18n/language.ts';
import type { ReportActivity, ReportActivityGroup, ReportSource, ReportSourceDetails } from '../../../shared/reportOverview.ts';
import { money } from './reportViewModel.ts';

export const reportSectionNames: Record<string, string> = {
  customer_debts: 'العملاء', company_debts: 'الشركات', libyan_deposits: 'الأمانات الليبية',
  egyptian_deposits: 'الأمانات المصرية', purchases: 'المشتريات', treasury: 'الخزينة', masraweya: 'المصراوية',
};
const kindNames: Record<string, string> = {
  debt: 'إضافة قيمة', payment: 'تسديد', opening: 'رصيد افتتاحي', purchase: 'شراء / تسديد مشتريات',
  in: 'دخول نقد', out: 'خروج نقد', daily_purchases: 'مشتريات المصراوية', daily_work: 'شغل المصراوية',
};
export function reportTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat(displayLocale, { timeZone: timezone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}
export function ReportDetails({ source, onClose, updatedAt }: { source: ReportSource; onClose: () => void; updatedAt: string }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ReportSourceDetails | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    let active = true;
    setBusy(true); setMessage(''); setData(null);
    void api.reportSourceDetails(source.key, page).then(next => { if (active) setData(next); })
      .catch(() => { if (active) setMessage(uiText('تعذر تحميل تفاصيل المصدر.')); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [source.key, page, updatedAt]);
  const currency = source.currency === 'EGP' ? uiText('ج.م') : uiText('د.ل');
  return <Modal title={uiText(source.label)} onClose={onClose} className="report-details-modal">
    <div className="report-details-content">
      <p>{uiText(source.explanation)}</p>
      <div className="report-details-total"><span>{uiText('إجمالي المصدر على كل الحسابات')}</span><strong dir="ltr">{money(source.balanceUnits, currency)}</strong></div>
      {message && <p role="alert">{message}</p>}
      {busy && <p role="status">{uiText('جارٍ تحميل التفاصيل…')}</p>}
      {data && <><div className="report-details-list">{data.items.map(item => <div key={item.id}>
        <span>{item.name}{item.linked && <small>{uiText('مرتبط بمصدره — محسوب مرة واحدة')}</small>}</span>
        <strong dir="ltr">{money(item.balanceUnits, currency)}</strong>
      </div>)}</div>{!data.items.length && <p>{uiText('لا توجد حسابات مسجلة في هذا المصدر.')}</p>}</>}
      <div className="report-pager"><button disabled={busy || page === 1} onClick={() => setPage(value => value - 1)}>{uiText('السابق')}</button>
        <span>{uiText('صفحة')} {page}</span><button disabled={busy || !data?.hasMore} onClick={() => setPage(value => value + 1)}>{uiText('التالي')}</button></div>
      <small>{uiText('قائمة للقراءة فقط؛ الإجمالي يشمل كل الصفحات، والأرصدة السالبة تُخصم منه.')}</small>
    </div>
  </Modal>;
}

export function ReportActivityPanel({ updatedAt, timezone }: { updatedAt: string; timezone: string }) {
  const [group, setGroup] = useState<ReportActivityGroup>('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ReportActivity | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const select = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    let active = true;
    setBusy(true); setMessage(''); setData(null);
    void api.reportActivity(group, page).then(next => { if (active) setData(next); })
      .catch(() => { if (active) setMessage(uiText('تعذر تحميل حركة اليوم.')); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [group, page, updatedAt]);
  return <section className="report-block report-activity" aria-label={uiText('تفاصيل حركة اليوم')}>
    <div className="report-block-head"><div><h2>{uiText('تفاصيل حركة اليوم')}</h2><p>{uiText('المصدر والموظف والوقت لكل حركة؛ العملات منفصلة.')}</p></div>
      <label>{uiText('المصدر')}<select ref={select} value={group} onChange={event => { setGroup(event.target.value as ReportActivityGroup); setPage(1); }}>
        <option value="all">{uiText('كل المصادر')}</option><option value="customers">{uiText('العملاء')}</option><option value="companies">{uiText('الشركات')}</option>
        <option value="libyan">{uiText('الأمانات الليبية')}</option><option value="egyptian">{uiText('الأمانات المصرية')}</option><option value="purchases">{uiText('المشتريات')}</option><option value="cash">{uiText('الخزينة')}</option>
      </select></label></div>
    <details className="report-activity-disclosure"><summary>{uiText('فتح تفاصيل المعاملات')}</summary>
    {message && <p role="alert">{message}</p>}{busy && <p role="status">{uiText('جارٍ تحميل التفاصيل…')}</p>}
    {data && <><div className="report-activity-table"><table><thead><tr><th>{uiText('الاسم والمصدر')}</th><th>{uiText('العملية')}</th><th>{uiText('القيمة')}</th><th>{uiText('أثرها على دفتر المصدر')}</th><th>{uiText('بواسطة')}</th><th>{uiText('الوقت')}</th></tr></thead>
      <tbody>{data.items.map(item => <tr key={item.id}>
        <td data-label={uiText('الاسم والمصدر')}>{item.name}<small>{uiText(reportSectionNames[item.sectionKey] ?? item.sectionKey)}</small></td>
        <td data-label={uiText('العملية')}>{uiText(kindNames[item.entryKind] ?? item.entryKind)}<small>{item.description}</small></td>
        <td data-label={uiText('القيمة')} dir="ltr">{money(item.amountUnits, item.currency === 'EGP' ? uiText('ج.م') : uiText('د.ل'))}</td>
        <td data-label={uiText('أثرها على دفتر المصدر')} dir="ltr">{item.effectUnits > 0 ? '+' : ''}{money(item.effectUnits, item.currency === 'EGP' ? uiText('ج.م') : uiText('د.ل'))}</td>
        <td data-label={uiText('بواسطة')}>{item.actorName}</td><td data-label={uiText('الوقت')}>{reportTime(item.occurredAt, timezone)}</td>
      </tr>)}</tbody></table></div>
      {!data.items.length && <p className="report-empty">{uiText('لا توجد حركات لهذا المصدر اليوم.')}</p>}
    </>}
    <div className="report-pager"><button disabled={busy || page === 1} onClick={() => setPage(value => value - 1)}>{uiText('السابق')}</button>
      <span>{uiText('صفحة')} {page}</span><button disabled={busy || !data?.hasMore} onClick={() => setPage(value => value + 1)}>{uiText('التالي')}</button></div>
    <p className="report-footnote">{uiText('الأثر يخص دفتر المصدر، وليس ربحًا أو مجموعًا يُضاف إلى الصافي. عمليات المشتريات قد تجمع الشراء والتسديد في صف واحد؛ العملات لا تُجمع معًا.')}</p>
    </details>
  </section>;
}
