import { uiText, displayLocale } from '../../i18n/language.ts';
import { CircleDollarSign, ClipboardCheck, Plus, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { DebtAccountsViewProps } from './DebtAccountsView.tsx';
import { debtSectionText } from './sectionConfig.ts';
import { EgyptianRateCard } from './EgyptianRateCard.tsx';
import { currencyLabel, isDepositSection } from './debtSectionUtils.ts';
import '../../styles/mobile-deposit-toolbar.css';

const money = new Intl.NumberFormat(displayLocale, { maximumFractionDigits: 0 });

export function DebtAccountsToolbar(props: DebtAccountsViewProps) {
  const { section, isAdmin, totalDebt: displayedTotal, activeCards, canWrite, routing, filter, query } = props;
  const labels = debtSectionText[section];
  const hasCompactDesktopToolbar = section === 'customers' || section === 'companies';
  const deposits = isDepositSection(section);
  const [depositFiltersOpen, setDepositFiltersOpen] = useState(false);
  const depositFilterRef = useRef<HTMLElement>(null);
  const { onQueryChange } = props;
  useEffect(() => {
    if (!deposits) return;
    const media = window.matchMedia('(max-width: 900px)');
    const sync = () => {
      setDepositFiltersOpen(false);
      // A desktop search must not remain active behind a hidden phone field.
      if (media.matches) onQueryChange('');
    };
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, [deposits, section, onQueryChange]);
  useEffect(() => {
    if (!depositFiltersOpen) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !depositFilterRef.current?.contains(event.target)) setDepositFiltersOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDepositFiltersOpen(false);
        depositFilterRef.current?.querySelector<HTMLButtonElement>('.deposit-mobile-active-toggle')?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [depositFiltersOpen]);
  const chooseFilter = (value: DebtAccountsViewProps['filter']) => {
    props.onFilterChange(value);
    setDepositFiltersOpen(false);
  };
  const total = (<article className="debt-total-card"><div className="summary-icon gold"><CircleDollarSign /></div><span>{isDepositSection(section) ? uiText("صافي إجمالي القسم") : uiText("صافي إجمالي الديون")}</span><strong>{money.format(displayedTotal)} <small>{currencyLabel(section)}</small></strong></article>);
  const add = (canWrite && <button className="add-customer-card" onClick={props.onAdd}><Plus size={22} /><span>{labels.add}</span></button>);
  const route = ((section === 'customers' || section === 'companies') && isAdmin && <button className={`routing-card ${routing ? 'active' : ''}`} onClick={routing ? props.onCancelRouting : props.onStartRouting}><ClipboardCheck size={21} /><span>{routing ? uiText("إلغاء التوجيه") : uiText("التوجيه")}</span></button>);
  const filters = section === 'egyptian-deposits' ? (<article className="active-cards-card egypt-active-count"><span>{uiText("النشطة")}</span><strong>{money.format(activeCards)}</strong></article>) : (<article className="active-cards-card" ref={section === 'libyan-deposits' ? depositFilterRef : undefined}>
    {section === 'libyan-deposits' && <button type="button" className="deposit-mobile-active-toggle" aria-label={uiText('فلترة الأمانات الليبية')} aria-expanded={depositFiltersOpen} aria-controls="deposit-libyan-filter-options" onClick={() => setDepositFiltersOpen(open => !open)}><span>{uiText('النشطة')}</span><strong>{money.format(activeCards)}</strong></button>}
    <div className="active-cards-count"><span>{uiText("عدد الكروت النشطة")}</span><strong>{money.format(activeCards)}</strong></div><div className="compact-filters" id={section === 'libyan-deposits' ? 'deposit-libyan-filter-options' : undefined} data-mobile-open={depositFiltersOpen ? 'true' : 'false'} role="tablist" aria-label={uiText("فلترة العملاء")}>{([['smart', uiText("الذكية")], ['today', uiText("اليوم")], ['due', uiText("ديون")], ['settled', uiText("مسدد")], ['pinned', uiText("مثبت")]] as const).map(([value, label]) => <button key={value} role="tab" aria-selected={filter === value} className={filter === value ? 'active' : ''} onClick={() => chooseFilter(value)}>{hasCompactDesktopToolbar && value === 'smart' ? <><span className="customer-smart-mobile-label">{label}</span><span className="customer-active-desktop-label">{uiText("نشطة ")}<b>{money.format(activeCards)}</b></span></> : label}</button>)}{section === 'customers' && isAdmin && <button role="tab" aria-selected={filter === 'pending-review'} className={filter === 'pending-review' ? 'active pending-review-filter' : 'pending-review-filter'} onClick={() => chooseFilter('pending-review')}>{uiText("صفر ينتظر المراجعة ")}<b>{money.format(props.pendingReviewCount)}</b></button>}</div></article>);
  const search = (<label className="dashboard-search"><span>{uiText("البحث")}</span><div className="search"><Search size={18} /><input aria-label={uiText("البحث باسم {0} أو الهاتف", [labels.singular])} value={query} onChange={(event) => props.onQueryChange(event.target.value)} placeholder={uiText("اسم {0} أو الهاتف…", [labels.singular])} /></div></label>);
  return <section className={`debts-toolbar ${isAdmin ? 'admin-debts-toolbar' : 'employee-debts-toolbar'} ${deposits ? 'deposit-mobile-toolbar' : ''} ${deposits && !canWrite ? 'deposit-mobile-readonly' : ''}`}>
    {hasCompactDesktopToolbar ? <>
      <div className="customer-summary-strip">{total}{filters}{(canWrite || isAdmin) && <div className="customer-actions-strip">{add}{route}</div>}{search}</div>
    </> : <>{total}{add}{route}{filters}{search}</>}
    {section === 'egyptian-deposits' && <EgyptianRateCard canWrite={canWrite} />}
  </section>;
}
