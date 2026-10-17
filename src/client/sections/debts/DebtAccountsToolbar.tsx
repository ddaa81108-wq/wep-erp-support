import { CircleDollarSign, ClipboardCheck, Plus, Search } from 'lucide-react';
import type { DebtAccountsViewProps } from './DebtAccountsView.tsx';
import { debtSectionText } from './sectionConfig.ts';
import { EgyptianRateCard } from './EgyptianRateCard.tsx';
import { currencyLabel, isDepositSection } from './debtSectionUtils.ts';

const money = new Intl.NumberFormat('ar-LY', { maximumFractionDigits: 0 });

export function DebtAccountsToolbar(props: DebtAccountsViewProps) {
  const { section, isAdmin, totalDebt: displayedTotal, activeCards, canWrite, routing, filter, query } = props;
  const labels = debtSectionText[section];
  const hasCompactDesktopToolbar = section === 'customers' || section === 'companies';
  const total = (<article className="debt-total-card"><div className="summary-icon gold"><CircleDollarSign /></div><span>{isDepositSection(section) ? 'صافي إجمالي القسم' : 'صافي إجمالي الديون'}</span><strong>{money.format(displayedTotal)} <small>{currencyLabel(section)}</small></strong></article>);
  const add = (canWrite && <button className="add-customer-card" onClick={props.onAdd}><Plus size={22} /><span>{labels.add}</span></button>);
  const route = ((section === 'customers' || section === 'companies') && isAdmin && <button className={`routing-card ${routing ? 'active' : ''}`} onClick={routing ? props.onCancelRouting : props.onStartRouting}><ClipboardCheck size={21} /><span>{routing ? 'إلغاء التوجيه' : 'التوجيه'}</span></button>);
  const filters = section === 'egyptian-deposits' ? (<article className="active-cards-card egypt-active-count"><span>النشطة</span><strong>{money.format(activeCards)}</strong></article>) : (<article className="active-cards-card"><div className="active-cards-count"><span>عدد الكروت النشطة</span><strong>{money.format(activeCards)}</strong></div><div className="compact-filters" role="tablist" aria-label="فلترة العملاء">{([['smart', 'الذكية'], ['today', 'اليوم'], ['due', 'ديون'], ['settled', 'مسدد'], ['pinned', 'مثبت']] as const).map(([value, label]) => <button key={value} role="tab" aria-selected={filter === value} className={filter === value ? 'active' : ''} onClick={() => props.onFilterChange(value)}>{hasCompactDesktopToolbar && value === 'smart' ? <><span className="customer-smart-mobile-label">{label}</span><span className="customer-active-desktop-label">نشطة <b>{money.format(activeCards)}</b></span></> : label}</button>)}{section === 'customers' && isAdmin && <button role="tab" aria-selected={filter === 'pending-review'} className={filter === 'pending-review' ? 'active pending-review-filter' : 'pending-review-filter'} onClick={() => props.onFilterChange('pending-review')}>صفر ينتظر المراجعة <b>{money.format(props.pendingReviewCount)}</b></button>}</div></article>);
  const search = (<label className="dashboard-search"><span>البحث</span><div className="search"><Search size={18} /><input aria-label={`البحث باسم ${labels.singular} أو الهاتف`} value={query} onChange={(event) => props.onQueryChange(event.target.value)} placeholder={`اسم ${labels.singular} أو الهاتف…`} /></div></label>);
  return <section className={`debts-toolbar ${isAdmin ? 'admin-debts-toolbar' : 'employee-debts-toolbar'}`}>
    {hasCompactDesktopToolbar ? <>
      <div className="customer-summary-strip">{total}{filters}{(canWrite || isAdmin) && <div className="customer-actions-strip">{add}{route}</div>}{search}</div>
    </> : <>{total}{add}{route}{filters}{search}</>}
    {section === 'egyptian-deposits' && <EgyptianRateCard canWrite={canWrite} />}
  </section>;
}
