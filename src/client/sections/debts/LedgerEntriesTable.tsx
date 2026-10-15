import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { Ledger, LedgerItem } from '../../api.ts';
import { LedgerDraftRow } from './LedgerDraftRow.tsx';
import { ledgerBalances } from './ledgerModel.ts';
import { LedgerRecordRow } from './LedgerRecordRow.tsx';
import { LedgerTotal } from './LedgerTotal.tsx';
import type { DebtSection } from './sectionConfig.ts';

function navigateLedgerRows(event: KeyboardEvent<HTMLDivElement>) {
  const target = event.target as HTMLElement;
  if (target.closest('input, select, button')) return;
  const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-ledger-row]')];
  const current = rows.indexOf(target.closest<HTMLElement>('[data-ledger-row]') as HTMLElement);
  if (current < 0 || !['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(event.key))
    return;
  event.preventDefault();
  let next = current;
  if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = rows.length - 1;
  else if (event.key === 'ArrowDown') next = Math.min(rows.length - 1, current + 1);
  else if (event.key === 'ArrowUp') next = Math.max(0, current - 1);
  else if (event.key === 'PageDown') next = Math.min(rows.length - 1, current + 5);
  else if (event.key === 'PageUp') next = Math.max(0, current - 5);
  rows[next]?.focus();
}

export function LedgerEntriesTable({
  section,
  ledger,
  canWrite,
  editing,
  busyId,
  newDraftKey,
  onEditingChange,
  onCancel,
  onSaved,
  onLoadOlder,
  onResetDraft,
  onConflict,
}: {
  section: DebtSection;
  ledger: Ledger;
  canWrite: boolean;
  editing: LedgerItem | null;
  busyId: string;
  newDraftKey: number;
  onEditingChange: (item: LedgerItem | null) => void;
  onCancel: (item: LedgerItem) => void;
  onSaved: (message: string) => Promise<void>;
  onLoadOlder: () => Promise<void>;
  onResetDraft: () => void;
  onConflict: () => Promise<void>;
}) {
  const [loadingOlder, setLoadingOlder] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);
  const balanceAfter = useMemo(() => ledgerBalances(ledger), [ledger]);
  useEffect(() => {
    const node = tableRef.current;
    if (!node) return;
    const frame = window.requestAnimationFrame(() => { node.scrollTop = node.scrollHeight; });
    return () => window.cancelAnimationFrame(frame);
  }, [ledger.customer.id]);
  useEffect(() => {
    if (!canWrite || (section !== 'customers' && section !== 'companies')) return;
    const frame = window.requestAnimationFrame(() => {
      const input = tableRef.current?.querySelector<HTMLInputElement>(
        '[data-new-ledger-draft] input[aria-label="قيمة المعاملة"]:not(:disabled)',
      );
      input?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [ledger.customer.id, newDraftKey, canWrite, section]);
  return (
    <div className="ledger-table-wrap" ref={tableRef} onKeyDown={navigateLedgerRows}>
      <div className="ledger-grid ledger-grid-head">
        {['التسلسل', 'اليوم والتاريخ والوقت', 'نوع الحركة', 'البيان', 'القيمة', 'العملية', (section === 'customers' || section === 'companies' || section === 'libyan-deposits') ? 'السعر' : 'المعامل', section === 'libyan-deposits' ? 'إيداع أمانة' : 'دين مضاف', section === 'libyan-deposits' ? 'سحب أمانة' : 'مدفوع', 'الرصيد', 'تعديل', 'إلغاء'].map((title) => <span key={title}>{(section === 'customers' || section === 'companies' || section === 'libyan-deposits') ? <b>{title}</b> : title}</span>)}
      </div>
      {ledger.nextCursor && (
        <button className="ledger-load-older" disabled={loadingOlder} onClick={async () => {
          setLoadingOlder(true);
          try { await onLoadOlder(); } finally { setLoadingOlder(false); }
        }}>
          {loadingOlder ? 'جارٍ تحميل المعاملات الأقدم…' : 'تحميل المعاملات الأقدم'}
        </button>
      )}
      {ledger.items.map((item) => editing?.id === item.id ? (
        <LedgerDraftRow key={`edit-${item.id}`} section={section} ledger={ledger} editing={item}
          onClose={() => onEditingChange(null)} onSaved={onSaved} onConflict={onConflict} />
      ) : (
        <LedgerRecordRow key={item.id} section={section} item={item}
          balanceAfter={balanceAfter.get(item.id) ?? 0} canWrite={canWrite} busy={busyId === item.id}
          onEdit={() => onEditingChange(item)} onCancel={() => onCancel(item)} />
      ))}
      {canWrite && (
        <LedgerDraftRow
          section={section}
          key={`new-${ledger.customer.nextSequence}-${newDraftKey}`}
          ledger={ledger}
          editing={null}
          onClose={onResetDraft}
          onSaved={onSaved}
          onConflict={onConflict}
        />
      )}
      {ledger.items.length === 0 && !canWrite && <div className="empty compact"><p>لا توجد معاملات بعد. يبدأ السجل من التسلسل رقم 1.</p></div>}
      <LedgerTotal section={section} ledger={ledger} />
    </div>
  );
}
