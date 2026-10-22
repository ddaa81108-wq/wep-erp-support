import { uiText } from '../../i18n/language.ts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpenCheck, RefreshCw, Search, ShieldCheck, TrendingDown, TrendingUp } from 'lucide-react';
import { api, ApiError, type FinancialLedgerEntry } from '../../api.ts';
import { Modal } from '../../components/Modal.tsx';

const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const sections: Array<[string, string]> = [
  ['', uiText("كل الأقسام")],
  ['customer_debts', uiText("ديون العملاء")],
  ['company_debts', uiText("ديون الشركات")],
  ['libyan_deposits', uiText("الأمانات الليبية")],
  ['egyptian_deposits', uiText("الأمانات المصرية")],
  ['masraweya', uiText("المصراوية")],
  ['purchases', uiText("المشتريات")],
  ['treasury', uiText("الخزينة")],
];
const sectionNames = Object.fromEntries(sections);
const entryNames: Record<string, string> = {
  debt: uiText("إضافة / دخول"),
  payment: uiText("تسديد / خروج"),
  purchase: uiText("مشتريات"),
  daily_purchases: uiText("مشتريات اليوم"),
  daily_work: uiText("شغل اليوم"),
  in: uiText("دخول نقدية"),
  out: uiText("خروج نقدية"),
};
const statusNames: Record<string, string> = {
  posted: uiText("معتمد"),
  draft: uiText("مفتوح"),
  finalized: uiText("مرحّل"),
  reversed: uiText("ملغي"),
  corrected: uiText("مصحح"),
  deleted: uiText("محذوف"),
};

function errorText(error: unknown) {
  return error instanceof ApiError ? error.message : uiText("تعذر تحميل سجل الأستاذ المالي.");
}

export function FinancialLedgerManager({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<FinancialLedgerEntry[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [totals, setTotals] = useState({ LYD: 0, EGP: 0 });
  const [section, setSection] = useState('');
  const [currency, setCurrency] = useState<'' | 'LYD' | 'EGP'>('');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const requestState = useRef({ sequence: 0 });

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const load = useCallback(
    async (before?: string | null) => {
      const sequence = ++requestState.current.sequence;
      setBusy(true);
      setError('');
      try {
        const page = await api.financialLedger({ before, section, currency, query: debouncedQuery });
        if (sequence !== requestState.current.sequence) return;
        setItems((current) => (before ? [...current, ...page.items] : page.items));
        setTotals((current) =>
          before
            ? { LYD: current.LYD + page.pageTotals.LYD, EGP: current.EGP + page.pageTotals.EGP }
            : page.pageTotals,
        );
        setNextBefore(page.nextBefore);
      } catch (caught) {
        if (sequence === requestState.current.sequence) setError(errorText(caught));
      } finally {
        if (sequence === requestState.current.sequence) setBusy(false);
      }
    },
    [section, currency, debouncedQuery],
  );

  useEffect(() => {
    const state = requestState.current;
    void load();
    return () => {
      state.sequence++;
    };
  }, [load]);

  return (
    <Modal title={uiText("سجل الأستاذ المالي")} className="financial-ledger-modal" onClose={onClose}>
      <div className="financial-ledger-manager">
        <section className="financial-ledger-summary">
          <article>
            <BookOpenCheck size={19} />
            <div>
              <small>{uiText("القيود المعروضة")}</small>
              <b dir="ltr">{number.format(items.length)}</b>
            </div>
          </article>
          <article className={totals.LYD >= 0 ? 'positive' : 'negative'}>
            {totals.LYD >= 0 ? <TrendingUp size={19} /> : <TrendingDown size={19} />}
            <div>
              <small>{uiText("صافي الصفحة — ليبي")}</small>
              <b dir="ltr">{number.format(totals.LYD)} {uiText(" د.ل")}</b>
            </div>
          </article>
          <article className={totals.EGP >= 0 ? 'positive' : 'negative'}>
            {totals.EGP >= 0 ? <TrendingUp size={19} /> : <TrendingDown size={19} />}
            <div>
              <small>{uiText("صافي الصفحة — مصري")}</small>
              <b dir="ltr">{number.format(totals.EGP)} {uiText(" ج.م")}</b>
            </div>
          </article>
          <div className="financial-ledger-readonly">
            <ShieldCheck size={18} />
            <span>
              <strong>{uiText("قراءة فقط")}</strong>
              <small>{uiText("لا يغيّر الأرصدة ولا يكرر تأثير المعاملات")}</small>
            </span>
          </div>
        </section>

        <section className="financial-ledger-toolbar">
          <label className="financial-ledger-search">
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={uiText("اسم، بيان، مرجع أو موظف…")}
              aria-label={uiText("البحث في سجل الأستاذ")}
            />
          </label>
          <select
            value={section}
            onChange={(event) => setSection(event.target.value)}
            aria-label={uiText("تصفية القسم")}
          >
            {sections.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            value={currency}
            onChange={(event) => setCurrency(event.target.value as '' | 'LYD' | 'EGP')}
            aria-label={uiText("تصفية العملة")}
          >
            <option value="">{uiText("كل العملات")}</option>
            <option value="LYD">{uiText("دينار ليبي")}</option>
            <option value="EGP">{uiText("جنيه مصري")}</option>
          </select>
          <button
            className="financial-ledger-refresh"
            onClick={() => void load()}
            disabled={busy}
            aria-label={uiText("تحديث سجل الأستاذ")}
            title={uiText("تحديث")}
          >
            <RefreshCw size={17} />
          </button>
        </section>

        {error && <div className="alert error">{error}</div>}
        <section className="financial-ledger-table-wrap">
          <div className="financial-ledger-head">
            <span>{uiText("التاريخ")}</span>
            <span>{uiText("القسم")}</span>
            <span>{uiText("الطرف / البيان")}</span>
            <span>{uiText("نوع القيد")}</span>
            <span>{uiText("القيمة")}</span>
            <span>{uiText("الأثر")}</span>
            <span>{uiText("بواسطة")}</span>
            <span>{uiText("الحالة")}</span>
          </div>
          <div className="financial-ledger-list">
            {items.map((entry) => {
              const date = new Date(entry.occurredAt);
              const positive = entry.effectUnits >= 0;
              return (
                <article className="financial-ledger-entry" key={entry.id}>
                  <div className="financial-ledger-date">
                    <b dir="ltr">{date.toLocaleDateString('en-GB')}</b>
                    <small dir="ltr">
                      {date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </small>
                  </div>
                  <strong className="financial-ledger-section">
                    {sectionNames[entry.sectionKey] ?? entry.sectionKey}
                  </strong>
                  <div className="financial-ledger-description">
                    <strong>{entry.counterpartyName || '—'}</strong>
                    <small>{entry.description || entry.referenceNo || uiText("بدون بيان")}</small>
                  </div>
                  <div>
                    <strong>{entryNames[entry.entryKind] ?? entry.entryKind}</strong>
                    <small dir="ltr">{entry.referenceNo || `#${entry.id}`}</small>
                  </div>
                  <b className="financial-ledger-amount" dir="ltr">
                    {number.format(entry.amountUnits)} {entry.currency === 'LYD' ? uiText("د.ل") : uiText("ج.م")}
                  </b>
                  <b className={`financial-ledger-effect ${positive ? 'positive' : 'negative'}`} dir="ltr">
                    {positive ? '+' : '−'}
                    {number.format(Math.abs(entry.effectUnits))}
                  </b>
                  <div>
                    <strong>{entry.actorName}</strong>
                    <small dir="ltr">{entry.actorUsername ? `@${entry.actorUsername}` : 'SYSTEM'}</small>
                  </div>
                  <span className={`financial-ledger-status ${entry.sourceStatus}`}>
                    {statusNames[entry.sourceStatus] ?? entry.sourceStatus}
                  </span>
                </article>
              );
            })}
            {!busy && items.length === 0 && (
              <div className="empty compact">
                <Search size={27} />
                <h3>{uiText("لا توجد قيود")}</h3>
                <p>{uiText("غيّر البحث أو المرشحات.")}</p>
              </div>
            )}
          </div>
        </section>
        <footer className="financial-ledger-footer">
          <span>{uiText("النتائج مقسمة إلى صفحات للحفاظ على سرعة المنظومة.")}</span>
          {nextBefore && (
            <button className="secondary" disabled={busy} onClick={() => void load(nextBefore)}>
              {uiText("عرض قيود أقدم")}</button>
          )}
          {busy && <span>{uiText("جارٍ التحديث…")}</span>}
        </footer>
      </div>
    </Modal>
  );
}
