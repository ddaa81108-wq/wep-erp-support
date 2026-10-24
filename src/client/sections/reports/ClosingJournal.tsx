import { useEffect, useState } from 'react';
import type { ReportClosing, ReportClosingJournal } from '../../../shared/reportOverview.ts';
import { api } from '../../api.ts';
import { Modal } from '../../components/Modal.tsx';
import { uiText } from '../../i18n/language.ts';
import { auditActionLabel } from '../settings/auditLogModel.ts';
import { money } from './reportViewModel.ts';
import { reportTime } from './ReportDetails.tsx';

export function ClosingJournal({ closing, canViewJournal, onClose }: { closing: ReportClosing; canViewJournal: boolean; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const [journal, setJournal] = useState<ReportClosingJournal | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!canViewJournal) return;
    let active = true;
    setBusy(true); setJournal(null); setError('');
    void api.reportClosingJournal(closing.businessDate, page).then(next => { if (active) setJournal(next); })
      .catch(() => { if (active) setError(uiText('تعذر تحميل سجل اللقطة.')); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [closing.businessDate, page, canViewJournal]);
  return <Modal title={uiText('تفاصيل لقطة {0}', [closing.businessDate])} onClose={onClose} className="closing-journal-modal">
    <div className="closing-journal-content"><div className="closing-journal-summary"><span>{uiText('صافي 05:00')}<b dir="ltr">{money(closing.netUnits)}</b></span>
      <span>{uiText('الفرق')}<b dir="ltr">{money(closing.changeUnits)}</b></span><span>{uiText('وقت التسجيل:')}<b>{reportTime(closing.capturedAt, 'Africa/Tripoli')}</b></span></div>
      <details className="closing-component-details"><summary>{uiText('تفسير الفرق في مكونات الصافي')}</summary>
        {closing.reasons.length ? closing.reasons.map(reason => <p key={reason.label}>{uiText(reason.label)}: <b dir="ltr">{money(reason.changeUnits)}</b></p>) : <p>{uiText('لا توجد مقارنة مكتملة أو لم تتغير مكونات الصافي.')}</p>}
      </details>
      {canViewJournal && <><h3>{uiText('سجل العمليات بين اللقطتين')}</h3><p className="closing-table-caption">{uiText('حسب وقت التنفيذ الفعلي، ويشمل التعديلات والإلغاءات. هذا سجل عمليات؛ لا تجمع صفوفه فوق الصافي.')}</p>
        {error && <p role="alert">{error}</p>}{busy && <p role="status">{uiText('جارٍ تحميل التفاصيل…')}</p>}
        {journal && <><p className="closing-journal-period">{uiText('من')} {reportTime(journal.from, 'Africa/Tripoli')} · {uiText('إلى')} {reportTime(journal.to, 'Africa/Tripoli')}</p>
          {journal.boundary === 'time' && <p className="closing-table-caption">{uiText('هذه لقطة قديمة أو أول لقطة؛ حدود سجلها بحسب التوقيت المحفوظ.')}</p>}
          <div className="closing-audit-list">{journal.items.map(item => {
            const currency = item.currency === 'EGP' ? uiText('ج.م') : item.currency === 'LYD' ? uiText('د.ل') : '';
            return <article key={item.id}><div><strong>{item.action === 'masraweya.save' ? uiText('حفظ يوم المصراوية') : auditActionLabel(item.action)}</strong>
              <span>{item.name || item.reference}</span><small>{item.actorName} · {reportTime(item.createdAt, 'Africa/Tripoli')}</small></div>
              <div className="closing-audit-values">{item.amountUnits !== null && <b dir="ltr">{money(item.amountUnits, currency)}</b>}
                {item.previousUnits !== null && item.nextUnits !== null && <span>{uiText('قبل:')} <b dir="ltr">{money(item.previousUnits, currency)}</b> · {uiText('بعد:')} <b dir="ltr">{money(item.nextUnits, currency)}</b></span>}
                {item.paidUnits !== null && <span>{uiText('المسدد:')} <b dir="ltr">{money(item.paidUnits, currency)}</b></span>}
                {item.description && <small>{item.description}</small>}</div></article>;
          })}</div>
          {!journal.items.length && <p>{uiText('لا توجد عمليات مسجلة في هذه الفترة.')}</p>}
          <div className="report-pager"><button disabled={busy || page === 1} onClick={() => setPage(value => value - 1)}>{uiText('السابق')}</button><span>{uiText('صفحة')} {page}</span>
            <button disabled={busy || !journal.hasMore} onClick={() => setPage(value => value + 1)}>{uiText('التالي')}</button></div>
        </>}
        <p className="closing-table-caption">{uiText('السجل يعرض التفاصيل التي حُفظت أصلًا وقت العملية. تفاصيل غير محفوظة لن نختلقها؛ الربط التلقائي وسعر التحويل يُراجعان من مكونات اللقطة.')}</p>
      </>}
    </div>
  </Modal>;
}
