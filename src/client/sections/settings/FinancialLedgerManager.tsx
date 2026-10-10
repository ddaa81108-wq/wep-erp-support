import { useEffect, useState } from 'react';
import { BookOpenCheck, RefreshCw, Search, ShieldCheck, TrendingDown, TrendingUp } from 'lucide-react';
import { api, ApiError, type FinancialLedgerEntry } from '../../api.ts';
import { Modal } from '../../components/Modal.tsx';

const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const sections: Array<[string, string]> = [
  ['', 'كل الأقسام'],
  ['customer_debts', 'ديون العملاء'],
  ['company_debts', 'ديون الشركات'],
  ['libyan_deposits', 'الأمانات الليبية'],
  ['egyptian_deposits', 'الأمانات المصرية'],
  ['masraweya', 'المصراوية'],
  ['purchases', 'المشتريات'],
  ['treasury', 'الخزينة'],
];
const sectionNames = Object.fromEntries(sections);
const entryNames: Record<string, string> = {
  debt: 'إضافة / دخول',
  payment: 'تسديد / خروج',
  purchase: 'مشتريات',
  daily_purchases: 'مشتريات اليوم',
  daily_work: 'شغل اليوم',
  in: 'دخول نقدية',
  out: 'خروج نقدية',
};
const statusNames: Record<string, string> = {
  posted: 'معتمد',
  draft: 'مفتوح',
  finalized: 'مرحّل',
  reversed: 'ملغي',
  corrected: 'مصحح',
  deleted: 'محذوف',
};

function errorText(error: unknown) {
  return error instanceof ApiError ? error.message : 'تعذر تحميل سجل الأستاذ المالي.';
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

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  async function load(before?: string | null) {
    setBusy(true);
    setError('');
    try {
      const page = await api.financialLedger({ before, section, currency, query: debouncedQuery });
      setItems((current) => (before ? [...current, ...page.items] : page.items));
      setTotals((current) =>
        before
          ? { LYD: current.LYD + page.pageTotals.LYD, EGP: current.EGP + page.pageTotals.EGP }
          : page.pageTotals,
      );
      setNextBefore(page.nextBefore);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
    // تغيير المرشحات يبدأ صفحة جديدة؛ التحميل الإضافي يتم من الزر أسفل السجل.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, currency, debouncedQuery]);

  return (
    <Modal title="سجل الأستاذ المالي" className="financial-ledger-modal" onClose={onClose}>
      <div className="financial-ledger-manager">
        <section className="financial-ledger-summary">
          <article>
            <BookOpenCheck size={19} />
            <div><small>القيود المعروضة</small><b dir="ltr">{number.format(items.length)}</b></div>
          </article>
          <article className={totals.LYD >= 0 ? 'positive' : 'negative'}>
            {totals.LYD >= 0 ? <TrendingUp size={19} /> : <TrendingDown size={19} />}
            <div><small>صافي الصفحة — ليبي</small><b dir="ltr">{number.format(totals.LYD)} د.ل</b></div>
          </article>
          <article className={totals.EGP >= 0 ? 'positive' : 'negative'}>
            {totals.EGP >= 0 ? <TrendingUp size={19} /> : <TrendingDown size={19} />}
            <div><small>صافي الصفحة — مصري</small><b dir="ltr">{number.format(totals.EGP)} ج.م</b></div>
          </article>
          <div className="financial-ledger-readonly">
            <ShieldCheck size={18} />
            <span><strong>قراءة فقط</strong><small>لا يغيّر الأرصدة ولا يكرر تأثير المعاملات</small></span>
          </div>
        </section>

        <section className="financial-ledger-toolbar">
          <label className="financial-ledger-search">
            <Search size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)}
              placeholder="اسم، بيان، مرجع أو موظف…" aria-label="البحث في سجل الأستاذ" />
          </label>
          <select value={section} onChange={(event) => setSection(event.target.value)} aria-label="تصفية القسم">
            {sections.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select value={currency} onChange={(event) => setCurrency(event.target.value as '' | 'LYD' | 'EGP')}
            aria-label="تصفية العملة">
            <option value="">كل العملات</option><option value="LYD">دينار ليبي</option><option value="EGP">جنيه مصري</option>
          </select>
          <button className="financial-ledger-refresh" onClick={() => void load()} disabled={busy}
            aria-label="تحديث سجل الأستاذ" title="تحديث"><RefreshCw size={17} /></button>
        </section>

        {error && <div className="alert error">{error}</div>}
        <section className="financial-ledger-table-wrap">
          <div className="financial-ledger-head">
            <span>التاريخ</span><span>القسم</span><span>الطرف / البيان</span><span>نوع القيد</span>
            <span>القيمة</span><span>الأثر</span><span>بواسطة</span><span>الحالة</span>
          </div>
          <div className="financial-ledger-list">
            {items.map((entry) => {
              const date = new Date(entry.occurredAt);
              const positive = entry.effectUnits >= 0;
              return (
                <article className="financial-ledger-entry" key={entry.id}>
                  <div className="financial-ledger-date"><b dir="ltr">{date.toLocaleDateString('en-GB')}</b>
                    <small dir="ltr">{date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</small></div>
                  <strong className="financial-ledger-section">{sectionNames[entry.sectionKey] ?? entry.sectionKey}</strong>
                  <div className="financial-ledger-description"><strong>{entry.counterpartyName || '—'}</strong>
                    <small>{entry.description || entry.referenceNo || 'بدون بيان'}</small></div>
                  <div><strong>{entryNames[entry.entryKind] ?? entry.entryKind}</strong>
                    <small dir="ltr">{entry.referenceNo || `#${entry.id}`}</small></div>
                  <b className="financial-ledger-amount" dir="ltr">{number.format(entry.amountUnits)} {entry.currency === 'LYD' ? 'د.ل' : 'ج.م'}</b>
                  <b className={`financial-ledger-effect ${positive ? 'positive' : 'negative'}`} dir="ltr">
                    {positive ? '+' : '−'}{number.format(Math.abs(entry.effectUnits))}
                  </b>
                  <div><strong>{entry.actorName}</strong><small dir="ltr">{entry.actorUsername ? `@${entry.actorUsername}` : 'SYSTEM'}</small></div>
                  <span className={`financial-ledger-status ${entry.sourceStatus}`}>{statusNames[entry.sourceStatus] ?? entry.sourceStatus}</span>
                </article>
              );
            })}
            {!busy && items.length === 0 && <div className="empty compact"><Search size={27} /><h3>لا توجد قيود</h3><p>غيّر البحث أو المرشحات.</p></div>}
          </div>
        </section>
        <footer className="financial-ledger-footer">
          <span>النتائج مقسمة إلى صفحات للحفاظ على سرعة المنظومة.</span>
          {nextBefore && <button className="secondary" disabled={busy} onClick={() => void load(nextBefore)}>عرض قيود أقدم</button>}
          {busy && <span>جارٍ التحديث…</span>}
        </footer>
      </div>
    </Modal>
  );
}
