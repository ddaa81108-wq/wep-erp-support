import { uiText, displayLocale } from '../../i18n/language.ts';
import { Check, Menu, Pin, PinOff, ShieldCheck, Users, X } from 'lucide-react';
import type { Customer, CustomerFilter } from '../../api.ts';
import { debtSectionText, type DebtSection } from './sectionConfig.ts';
import { DebtAccountsToolbar } from './DebtAccountsToolbar.tsx';
import { DebtTicker } from './DebtTicker.tsx';
import { ZeroReviewButton } from './ZeroReviewButton.tsx';
import { currencyLabel, isDepositSection } from './debtSectionUtils.ts';
import { useEffect, useRef, useState } from 'react';

type Notice = { kind: 'success' | 'error'; text: string } | null;
type Assignee = { id: string; username: string; displayName: string };

export type DebtAccountsViewProps = {
  section: DebtSection;
  isAdmin: boolean;
  customers: Customer[];
  visibleCustomers: Customer[];
  totalDebt: number;
  activeCards: number;
  pendingReviewCount: number;
  onReviewZero: (customer: Customer) => Promise<void>;
  totalItems: number;
  canRead: boolean;
  canWrite: boolean;
  loading: boolean;
  loadError: boolean;
  onRetryLoad: () => void;
  loadingMore: boolean;
  hasMore: boolean;
  query: string;
  filter: CustomerFilter;
  notice: Notice;
  routing: boolean;
  selectedCustomers: string[];
  assignees: Assignee[];
  assigneeId: string;
  onOpenMenu: () => void;
  onQueryChange: (value: string) => void;
  onFilterChange: (value: CustomerFilter) => void;
  onDismissNotice: () => void;
  onAdd: () => void;
  onStartRouting: () => void;
  onCancelRouting: () => void;
  onAssigneeChange: (id: string) => void;
  onCustomerSelection: (id: string, selected: boolean) => void;
  onConfirmRouting: () => void;
  onRemoveAssignment: (customer: Customer) => void;
  cancellingAssignmentId: string | null;
  onOpenLedger: (id: string) => void;
  onTogglePinned: (customer: Customer) => void;
  onLoadMore: () => void;
  cardSearchTarget?: { id: string; request: number } | null;
};

const money = new Intl.NumberFormat(displayLocale, { maximumFractionDigits: 0 });
const movementTime = new Intl.DateTimeFormat(displayLocale, { dateStyle: 'short', timeStyle: 'short' });
const canRouteDebtCard = (customer: Customer) => customer.balanceUnits > 0 && !customer.activeAssigneeName;

function customerCardState(customer: Customer) {
  if (customer.balanceUnits < 0) return 'credit-balance';
  if (customer.balanceUnits === 0) return 'zero-balance';
  if ((customer.debtAgeDays ?? 0) >= 7) return 'overdue-debt';
  if ((customer.debtAgeDays ?? 0) >= 3) return 'warning-debt';
  return 'new-debt';
}

function sectionCardState(section: DebtSection, customer: Customer) {
  if (!isDepositSection(section)) return customerCardState(customer);
  if (customer.balanceUnits === 0) return 'zero-balance';
  if (section === 'libyan-deposits') return customer.balanceUnits > 0 ? 'credit-balance' : 'overdue-debt';
  return customer.balanceUnits > 0 ? 'new-debt' : 'overdue-debt';
}

function cardLabel(section: DebtSection, customer: Customer) {
  if (isDepositSection(section)) {
    if (customer.balanceUnits > 0) return debtSectionText[section].positiveLabel;
    if (customer.balanceUnits < 0) return debtSectionText[section].negativeLabel;
    return uiText("حساب صفر");
  }
  if (customer.balanceUnits < 0) return uiText("أمانة");
  if (customer.balanceUnits === 0) return uiText("حساب صفر");
  if ((customer.debtAgeDays ?? 0) >= 7) return uiText("دين متأخر");
  if ((customer.debtAgeDays ?? 0) >= 3) return uiText("مرّ عليه 3 أيام");
  return uiText("دين جديد");
}

export function DebtAccountsView(props: DebtAccountsViewProps) {
  const {
    section, isAdmin, customers, visibleCustomers, totalItems,
    canRead, canWrite, loading, loadingMore, hasMore, query, notice,
    routing, selectedCustomers, assignees, assigneeId,
  } = props;
  const labels = debtSectionText[section];
  const grid = useRef<HTMLDivElement>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const searchTarget = props.cardSearchTarget;
  const targetVisible = Boolean(searchTarget && visibleCustomers.some(item => item.id === searchTarget.id));
  useEffect(() => {
    if (!searchTarget || !targetVisible || loading) { setHighlightedId(null); return; }
    setHighlightedId(searchTarget.id);
    const frame = window.requestAnimationFrame(() => {
      const card = grid.current?.querySelector<HTMLElement>(`[data-customer-id="${CSS.escape(searchTarget.id)}"]`);
      card?.scrollIntoView({ block: 'center', behavior: 'instant' });
      card?.querySelector<HTMLButtonElement>('.customer-card-main')?.focus({ preventScroll: true });
    });
    const timer = window.setTimeout(() => setHighlightedId(null), 5000);
    return () => { window.cancelAnimationFrame(frame); window.clearTimeout(timer); };
  }, [searchTarget, targetVisible, loading]);
  const assignmentBadge = (customer: Customer) => !customer.activeAssigneeName ? null :
    isAdmin && customer.activeAssignmentId ? <button type="button"
      className="customer-assignee-badge cancel-assignment"
      disabled={Boolean(props.cancellingAssignmentId)}
      aria-label={uiText('إلغاء توجيه {0} من {1}', [customer.name, customer.activeAssigneeName])}
      title={uiText('إلغاء التوجيه')}
      onClick={() => props.onRemoveAssignment(customer)}>
      {uiText("لدى: ")}{customer.activeAssigneeName} ×
    </button> : <span className="customer-assignee-badge">{uiText("لدى: ")}{customer.activeAssigneeName}</span>;

  return <>
    {!isDepositSection(section) && <DebtTicker customers={customers} onOpenLedger={props.onOpenLedger} />}
    <header className="topbar"><button className="icon-button menu-button" onClick={props.onOpenMenu}><Menu /></button><div><h1>{labels.title}</h1><p>{uiText("بطاقات ")}{labels.plural} {uiText(" وسجل موحد دائم لكل ")}{labels.singular}</p></div></header>
    <DebtAccountsToolbar {...props} />
    <section className="content-card">
      {notice && <div className={`alert ${notice.kind}`}>{notice.text}<button onClick={props.onDismissNotice}><X size={16} /></button></div>}
      {routing && <div className="routing-bar"><select value={assigneeId} onChange={(event) => props.onAssigneeChange(event.target.value)}>{assignees.map((assignee) => <option value={assignee.id} key={assignee.id}>{assignee.displayName}</option>)}</select><span>{uiText("تم اختيار ")}{selectedCustomers.length} {uiText(" كارت")}</span><button disabled={!assigneeId || selectedCustomers.length === 0} onClick={props.onConfirmRouting}>{uiText("تأكيد التوجيه")}</button></div>}
      {!canRead
        ? <div className="empty"><ShieldCheck size={38} /><h3>{uiText("لا توجد صلاحية لعرض ")}{labels.plural}</h3><p>{uiText("يمكن للمدير تفعيل صلاحية العرض من الإعدادات.")}</p></div>
        : loading
          ? <div className="empty"><div className="spinner" /><p>{uiText("جارٍ تحميل الحسابات…")}</p></div>
          : props.loadError && visibleCustomers.length === 0
            ? <div className="empty" role="alert"><p>{uiText('تعذر تحميل الحسابات. أعد المحاولة.')}</p><button onClick={props.onRetryLoad}>{uiText('إعادة المحاولة')}</button></div>
          : visibleCustomers.length === 0
            ? <div className="empty"><Users size={38} /><h3>{query ? uiText("لا توجد نتائج") : uiText("لا توجد كروت في هذا العرض")}</h3><p>{query ? uiText("البحث يشمل {0} الظاهرين والمخفيين ذكيًا.", [labels.plural]) : canWrite ? uiText("{0} أو اختر فلترًا آخر.", [labels.add]) : uiText("لا توجد حسابات مسجلة.")}</p></div>
            : <><div className="customer-card-grid" ref={grid}>{visibleCustomers.map((customer) => {
              const selected = selectedCustomers.includes(customer.id);
              const canRoute = canRouteDebtCard(customer);
              const showReview = (section === 'customers' ? isAdmin : canWrite) && !routing && !customer.systemManaged;
              const badge = section === 'customers' || section === 'companies' ? assignmentBadge(customer) : null;
              return <article key={customer.id} data-customer-id={customer.id} data-search-highlight={highlightedId === customer.id || undefined} data-balance-owner={customer.balanceUnits === 0 ? 'zero' : (section === 'libyan-deposits' ? customer.balanceUnits > 0 : customer.balanceUnits < 0) ? 'customer' : 'system'} className={`customer-card ${sectionCardState(section, customer)} ${customer.systemManaged ? 'system-linked-card' : ''} ${selected ? 'selected-routing' : ''} ${customer.activeAssigneeName ? 'has-assignee' : ''} ${routing && !canRoute ? 'routing-unavailable' : ''}`}>
                {routing && canRoute && <label className="routing-select"><input type="checkbox" checked={selected} onChange={(event) => props.onCustomerSelection(customer.id, event.target.checked)} /><span><Check size={16} /></span></label>}
                {(showReview || badge) && <div className="customer-card-status-row">{badge}{showReview && <ZeroReviewButton customer={customer} onReview={props.onReviewZero} />}</div>}
                <button className="customer-card-main" onClick={() => routing ? canRoute && props.onCustomerSelection(customer.id, !selected) : props.onOpenLedger(customer.id)}><span className="customer-card-label">{customer.systemManaged ? uiText("مرتبط تلقائيًا") : cardLabel(section, customer)}</span><strong className="customer-name-line"><span>{customer.name}</span></strong><b><span className="customer-balance-amount">{money.format(Math.abs(customer.balanceUnits))}</span> <small>{currencyLabel(section)}</small></b><small className="customer-last-movement">{uiText("آخر حركة: ")}{movementTime.format(new Date(customer.updatedAt ?? customer.createdAt))}</small></button>
                {canWrite && !routing && !customer.systemManaged && <button className="pin-customer" aria-label={customer.isPinned ? uiText("إلغاء تثبيت {0}", [customer.name]) : uiText("تثبيت {0}", [customer.name])} title={customer.isPinned ? uiText("إلغاء التثبيت") : uiText("إبقاء الكارت ظاهرًا دائمًا")} onClick={() => props.onTogglePinned(customer)}>{customer.isPinned ? <PinOff size={17} /> : <Pin size={17} />}</button>}

              </article>;
            })}</div>{hasMore && <button className="load-more-cards" disabled={loadingMore} onClick={props.onLoadMore}>{loadingMore ? uiText("جارٍ تحميل المزيد…") : uiText("تحميل المزيد — ظاهر {0} من {1}", [money.format(customers.length), money.format(totalItems)])}</button>}</>}
    </section>
  </>;
}
