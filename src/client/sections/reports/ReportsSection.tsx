import { lazy, Suspense, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, ChartNoAxesCombined, CircleCheck, LockKeyhole, RefreshCw } from 'lucide-react';
import { direction, uiText } from '../../i18n/language.ts';
import type { ReportSource } from '../../../shared/reportOverview.ts';
import { ReportActivityPanel, ReportDetails, reportTime } from './ReportDetails.tsx';
import { money } from './reportViewModel.ts';
import { useReportOverview } from './useReportOverview.ts';

const Legacy = lazy(() => import('./LegacyReportsSection.tsx').then(module => ({ default: module.ReportsSection })));
export function ReportsSection() {
  const [legacy, setLegacy] = useState(false);
  return <><div className="report-preview-switch"><span>{uiText('التقارير الجديدة')}</span>
    <button onClick={() => setLegacy(value => !value)}>{uiText(legacy ? 'العودة للوحة الجديدة' : 'مقارنة بالتقرير السابق')}</button></div>
    {legacy ? <Suspense fallback={<p>{uiText('جارٍ إعداد التقرير…')}</p>}><Legacy /></Suspense> : <FinancialOverview />}</>;
}

function FinancialOverview() {
  const { data, busy, message, load } = useReportOverview();
  const [selected, setSelected] = useState<ReportSource | null>(null);
  if (!data) return <section className="financial-overview" dir={direction}>
    <p role={message ? 'alert' : 'status'}>{message || uiText('جارٍ قراءة المصادر المالية…')}</p>
    {message && <button onClick={() => void load().catch(() => undefined)}>{uiText('إعادة المحاولة')}</button>}
  </section>;
  const { position, daily, attention } = data;
  const pending = attention.pendingCount + attention.outstandingCount + attention.currencyMismatchCount;
  const netLabel = position.netUnits === null ? 'صافي غير مكتمل' : position.netUnits > 0 ? 'صافي المركز — لنا' : position.netUnits < 0 ? 'صافي المركز — علينا' : 'صافي المركز — متوازن';
  const closingState = data.latestClosing.state;
  const dailyCards = [
    ['ديون وأرصدة افتتاحية أُضيفت اليوم', daily.debtsUnits], ['تسديدات العملاء والشركات', daily.paymentsUnits],
    ['مشتريات اليوم بالدينار', daily.purchasesUnits], ['تسديدات المشتريات', daily.purchasePaymentsUnits],
    ['نقد دخل الخزينة', daily.cashInUnits], ['نقد خرج من الخزينة', daily.cashOutUnits],
  ] as const;
  return <section className="financial-overview" dir={direction}>
    <header className="financial-overview-head"><div><span className="report-eyebrow"><ChartNoAxesCombined size={17} />{uiText('التقارير الذكية')}</span>
      <h1>{uiText('موقفك المالي، بوضوح')}</h1><p>{uiText('قراءة تلقائية من دفاتر المنظومة؛ كل مصدر محسوب مرة واحدة.')}</p></div>
      <div className="report-live-status"><span><i />{busy ? uiText('جارٍ التحديث…') : uiText('آخر قراءة ناجحة')}</span>
        <time>{reportTime(data.generatedAt, data.timezone)}</time>
        <button disabled={busy} aria-label={uiText('تحديث بيانات التقرير الآن')} onClick={() => void load().catch(() => undefined)}><RefreshCw size={16} /></button></div></header>
    {message && <div className="report-reading-error" role="alert">{message}</div>}
    <div className="report-read-only"><LockKeyhole size={14} /><span>{uiText('للقراءة فقط — لا يضيف معاملات ولا يعدّل أرصدة ولا يقفل الأقسام.')}</span></div>
    <section className="report-position-grid" aria-label={uiText('موقفك الآن')}>
      <article className={`report-position-card report-position-net ${position.netUnits !== null && position.netUnits < 0 ? 'is-negative' : ''}`}>
        <span>{uiText(netLabel)}</span><strong data-testid="report-net" dir="ltr">{position.netUnits === null ? '—' : money(Math.abs(position.netUnits))}</strong>
        <p>{uiText('صافي مركز مالي، وليس ربحًا أو نقدًا متاحًا للصرف.')}</p>
      </article>
      <article className="report-position-card"><span><ArrowDownLeft size={18} />{uiText('صافي حسابات لنا')}</span><strong data-testid="report-receivables" dir="ltr">{money(position.receivablesUnits)}</strong>
        <p>{uiText('العملاء + الشركات، بعد خصم أرصدتهم الدائنة.')}</p></article>
      <article className="report-position-card"><span><ArrowUpRight size={18} />{uiText('صافي حسابات علينا')}</span><strong data-testid="report-liabilities" dir="ltr">{money(position.liabilitiesUnits)}</strong>
        <p>{uiText('باقي المشتريات + الأمانات الليبية، وفق أرصدة الأقسام.')}</p></article>
    </section>
    <section className="report-block"><div className="report-block-head"><div><h2>{uiText('من أين جاءت الأرقام؟')}</h2><p>{uiText('اضغط المصدر لرؤية الحسابات التي تكوّن إجماليه.')}</p></div><span className="report-date">{data.businessDate}</span></div>
      <div className="report-sources">{data.sources.map(source => <button className="report-source" key={source.key} onClick={() => setSelected(source)}>
        <span>{uiText(source.label)}</span><strong dir="ltr">{money(source.balanceUnits, source.currency === 'EGP' ? uiText('ج.م') : uiText('د.ل'))}</strong>
        <small>{source.count} {uiText('حساب / دفتر')} · {uiText('عرض التفاصيل')}</small>
      </button>)}</div>
      <div className={`report-exchange ${position.convertedUnits === null ? 'is-incomplete' : ''}`}>
        <strong>{uiText('المصري منفصل:')} <b dir="ltr">{money(position.egyptianUnits, uiText('ج.م'))}</b></strong>
        <span>{position.rate === null ? uiText('لا يوجد سعر تحويل معتمد مسجّل.') : <>{uiText('السعر المسجّل: كل 1 د.ل =')} <b dir="ltr">{position.rate} {uiText('ج.م')}</b></>}</span>
        <span>{position.convertedUnits === null ? uiText('لن نعرض صافيًا مكتملًا قبل توفر سعر التحويل.') : <>{uiText('المقابل المحتسب:')} <b dir="ltr">{money(position.convertedUnits)}</b></>}</span>
        {position.rateUpdatedAt && <small>{uiText('تحديث السعر:')} {reportTime(position.rateUpdatedAt, data.timezone)}</small>}
      </div>
      <p className="report-footnote">{uiText('الصافي = صافي حسابات لنا + النقد بالخزينة + المقابل المصري − صافي حسابات علينا. الأرصدة السالبة محتسبة بإشارتها؛ لا نجمع العملات مباشرة.')}</p>
    </section>
    <div className="report-middle-grid"><section className="report-block"><div className="report-block-head"><div><h2>{uiText('ماذا حدث اليوم؟')}</h2><p>{uiText('حركة اليوم حسب توقيت المنظومة؛ منفصلة عن الأرصدة الحالية.')}</p></div></div>
      <div className="report-daily-grid">{dailyCards.map(([label, value]) => <article key={label}><span>{uiText(label)}</span><strong dir="ltr">{money(value)}</strong></article>)}</div>
      <p className="report-footnote">{uiText('خروج النقد ليس بالضرورة مصروفًا. هذه قيم المعاملات السارية بعد التصحيح والإلغاء، وليست سجلًا تاريخيًا لكل ضغطة تعديل.')}</p>
    </section><aside className="report-block report-attention"><div className="report-block-head"><div><h2>{uiText('يحتاج متابعة')}</h2><p>{uiText('بنود فعلية مسجلة، دون تنبؤات أو أحكام آلية.')}</p></div></div>
      {position.netUnits === null && <div className="report-attention-item"><strong>{uiText('سعر التحويل مفقود')}</strong><p>{uiText('الأرصدة بعملاتها ظاهرة؛ الصافي المحوّل غير مكتمل.')}</p></div>}
      {attention.pendingCount > 0 && <div className="report-attention-item"><strong>{attention.pendingCount} {uiText('تحصيلات تنتظر الاعتماد')}</strong><b dir="ltr">{money(attention.pendingUnits)}</b><p>{uiText('للمتابعة فقط؛ لا تُضاف مرة ثانية إلى المركز المالي.')}</p></div>}
      {attention.outstandingCount > 0 && <div className="report-attention-item"><strong>{attention.outstandingCount} {uiText('تحصيلات معتمدة تنتظر تسليم النقد')}</strong><b dir="ltr">{money(attention.outstandingUnits)}</b></div>}
      {attention.currencyMismatchCount > 0 && <div className="report-attention-item"><strong>{attention.currencyMismatchCount} {uiText('ربط قديم بعملة مخالفة يحتاج مراجعة')}</strong><p>{uiText('لا يجري التقرير تحويلًا أو إصلاحًا تلقائيًا للرصيد.')}</p></div>}
      {!pending && position.netUnits !== null && <div className="report-no-attention"><CircleCheck size={25} /><strong>{uiText('لا توجد بنود معلقة مسجلة')}</strong><p>{uiText('هذا ليس بديلًا عن فحص المطابقة المالية الشامل.')}</p></div>}
    </aside></div>
    <section className="report-block report-closings"><div className="report-block-head"><div><h2>{uiText('صافي الخامسة صباحًا')}</h2><p>{uiText('لقطات ثابتة بتوقيت ليبيا ليوم العمل السابق؛ لا تقفل أي قسم.')}</p></div>
      <span className="report-date">{data.latestClosing.businessDate}</span></div>
      <div className="report-closing-state" data-testid="latest-report-closing">{closingState === 'recorded' ? <>{uiText('الصافي المسجّل:')} <b dir="ltr">{money(data.latestClosing.netUnits)}</b></>
        : uiText(closingState === 'pending' ? 'بانتظار موعد الخامسة صباحًا.' : closingState === 'missed' ? 'لم تُسجّل اللقطة في موعدها؛ لن نختلق رقمًا بأثر رجعي.' : 'اللقطة غير مكتملة؛ سعر التحويل كان مفقودًا.')}</div>
      {data.closings.length > 0 ? <div className="report-closing-list">{data.closings.map(closing => <details key={closing.businessDate}>
        <summary><span>{closing.businessDate}</span><strong dir="ltr">{money(closing.netUnits)}</strong><small>{uiText('الفرق عن آخر لقطة محفوظة:')} <b dir="ltr">{closing.changeUnits === null ? '—' : `${closing.changeUnits > 0 ? '+' : ''}${money(closing.changeUnits)}`}</b></small></summary>
        <p>{uiText('وقت التسجيل:')} {reportTime(closing.capturedAt, 'Africa/Tripoli')}</p>
        {closing.reasons.length ? closing.reasons.map(reason => <p key={reason.label}>{uiText(reason.label)}: <b dir="ltr">{money(reason.changeUnits)}</b></p>) : <p>{uiText('لا توجد مقارنة مكتملة أو لم تتغير مكونات الصافي.')}</p>}
      </details>)}</div> : <p className="report-empty">{uiText('لا توجد لقطات خامسة صباحًا محفوظة بعد.')}</p>}
    </section>
    <ReportActivityPanel updatedAt={data.generatedAt} timezone={data.timezone} />
    {selected && <ReportDetails key={selected.key} source={data.sources.find(source => source.key === selected.key)!} updatedAt={data.generatedAt} onClose={() => setSelected(null)} />}
  </section>;
}
