import { Check, Menu, Pin, PinOff, ShieldCheck, Users, X } from 'lucide-react';
import type { Customer, CustomerFilter } from '../../api.ts';
import { debtSectionText, type DebtSection } from './sectionConfig.ts';
import { DebtAccountsToolbar } from './DebtAccountsToolbar.tsx';
import { DebtTicker } from './DebtTicker.tsx';
import { ZeroReviewButton } from './ZeroReviewButton.tsx';
import { currencyLabel, isDepositSection } from './debtSectionUtils.ts';

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
  onOpenLedger: (id: string) => void;
  onTogglePinned: (customer: Customer) => void;
  onLoadMore: () => void;
};

const money = new Intl.NumberFormat('ar-LY', { maximumFractionDigits: 0 });
const movementTime = new Intl.DateTimeFormat('ar-LY', { dateStyle: 'short', timeStyle: 'short' });
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
    return 'حساب صفر';
  }
  if (customer.balanceUnits < 0) return 'أمانة';
  if (customer.balanceUnits === 0) return 'حساب صفر';
  if ((customer.debtAgeDays ?? 0) >= 7) return 'دين متأخر';
  if ((customer.debtAgeDays ?? 0) >= 3) return 'مرّ عليه 3 أيام';
  return 'دين جديد';
}

export function DebtAccountsView(props: DebtAccountsViewProps) {
  const {
    section, isAdmin, customers, visibleCustomers, totalItems,
    canRead, canWrite, loading, loadingMore, hasMore, query, notice,
    routing, selectedCustomers, assignees, assigneeId,
  } = props;
  const labels = debtSectionText[section];

  return <>
    {!isDepositSection(section) && <DebtTicker customers={customers} onOpenLedger={props.onOpenLedger} />}
    <header className="topbar"><button className="icon-button menu-button" onClick={props.onOpenMenu}><Menu /></button><div><h1>{labels.title}</h1><p>بطاقات {labels.plural} وسجل موحد دائم لكل {labels.singular}</p></div></header>
    <DebtAccountsToolbar {...props} />
    <section className="content-card">
      {notice && <div className={`alert ${notice.kind}`}>{notice.text}<button onClick={props.onDismissNotice}><X size={16} /></button></div>}
      {routing && <div className="routing-bar"><select value={assigneeId} onChange={(event) => props.onAssigneeChange(event.target.value)}>{assignees.map((assignee) => <option value={assignee.id} key={assignee.id}>{assignee.displayName}</option>)}</select><span>تم اختيار {selectedCustomers.length} كارت</span><button disabled={!assigneeId || selectedCustomers.length === 0} onClick={props.onConfirmRouting}>تأكيد التوجيه</button></div>}
      {!canRead
        ? <div className="empty"><ShieldCheck size={38} /><h3>لا توجد صلاحية لعرض {labels.plural}</h3><p>يمكن للمدير تفعيل صلاحية العرض من الإعدادات.</p></div>
        : loading
          ? <div className="empty"><div className="spinner" /><p>جارٍ تحميل الحسابات…</p></div>
          : visibleCustomers.length === 0
            ? <div className="empty"><Users size={38} /><h3>{query ? 'لا توجد نتائج' : 'لا توجد كروت في هذا العرض'}</h3><p>{query ? `البحث يشمل ${labels.plural} الظاهرين والمخفيين ذكيًا.` : canWrite ? `${labels.add} أو اختر فلترًا آخر.` : 'لا توجد حسابات مسجلة.'}</p></div>
            : <><div className="customer-card-grid">{visibleCustomers.map((customer) => {
              const selected = selectedCustomers.includes(customer.id);
              const canRoute = canRouteDebtCard(customer);
              return <article key={customer.id} className={`customer-card ${sectionCardState(section, customer)} ${customer.systemManaged ? 'system-linked-card' : ''} ${selected ? 'selected-routing' : ''} ${customer.activeAssigneeName ? 'has-assignee' : ''} ${routing && !canRoute ? 'routing-unavailable' : ''}`}>
                {routing && canRoute && <label className="routing-select"><input type="checkbox" checked={selected} onChange={(event) => props.onCustomerSelection(customer.id, event.target.checked)} /><span><Check size={16} /></span></label>}
                {section === 'customers' ? <div className="customer-card-status-row">{customer.activeAssigneeName && <span className="customer-assignee-badge">لدى: {customer.activeAssigneeName}</span>}{isAdmin && !routing && <ZeroReviewButton customer={customer} onReview={props.onReviewZero} />}</div> : section === 'companies' && customer.activeAssigneeName && <span className="customer-assignee-badge">لدى: {customer.activeAssigneeName}</span>}
                <button className="customer-card-main" onClick={() => routing ? canRoute && props.onCustomerSelection(customer.id, !selected) : props.onOpenLedger(customer.id)}><span className="customer-card-label">{customer.systemManaged ? 'مرتبط تلقائيًا' : cardLabel(section, customer)}</span><strong className="customer-name-line"><span>{customer.name}</span></strong><b><span className="customer-balance-amount">{money.format(Math.abs(customer.balanceUnits))}</span> <small>{currencyLabel(section)}</small></b><small className="customer-last-movement">آخر حركة: {movementTime.format(new Date(customer.updatedAt ?? customer.createdAt))}</small></button>
                {canWrite && !routing && !customer.systemManaged && <button className="pin-customer" aria-label={customer.isPinned ? `إلغاء تثبيت ${customer.name}` : `تثبيت ${customer.name}`} title={customer.isPinned ? 'إلغاء التثبيت' : 'إبقاء الكارت ظاهرًا دائمًا'} onClick={() => props.onTogglePinned(customer)}>{customer.isPinned ? <PinOff size={17} /> : <Pin size={17} />}</button>}

              </article>;
            })}</div>{hasMore && <button className="load-more-cards" disabled={loadingMore} onClick={props.onLoadMore}>{loadingMore ? 'جارٍ تحميل المزيد…' : `تحميل المزيد — ظاهر ${money.format(customers.length)} من ${money.format(totalItems)}`}</button>}</>}
    </section>
  </>;
}
