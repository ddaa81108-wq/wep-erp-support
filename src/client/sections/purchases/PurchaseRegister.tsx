import { uiText } from '../../i18n/language.ts';
import { flushBeforeNavigation } from '../../dashboard/navigationGuards.ts';
import { useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { PurchaseInlineEditor } from './PurchaseInlineEditor.tsx';
import type { usePurchasesPage } from './usePurchasesPage.ts';
import { PurchaseRegisterHeader } from './PurchaseRegisterHeader.tsx';
import { PurchaseEntryGroup } from './PurchaseEntryGroup.tsx';
import { PurchaseRegisterTotals } from './PurchaseRegisterTotals.tsx';
import { PurchaseCarryRow } from './PurchaseCarryRow.tsx';
import { purchaseRunningBalances } from './purchaseRunningBalance.ts';

type PurchaseRegisterProps = {
  purchases: ReturnType<typeof usePurchasesPage>;
  canWrite: boolean;
  canFinalize: boolean;
};

export function PurchaseRegister({ purchases, canWrite, canFinalize }: PurchaseRegisterProps) {
  const registerRef = useRef<HTMLDivElement>(null);
  const {
    merchant,
    page,
    entries,
    editingId,
    setEditingId,
    busy,
    setBusy,
    setMessage,
    load,
    markDirty,
    cancelEditing,
    remove,
    toggleCorrection,
    older,
  } = purchases;
  const hasPage = page !== null;

  useEffect(() => {
    if (!hasPage) return;
    const node = registerRef.current;
    if (!node) return;
    const frame = window.requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [hasPage, merchant, page?.day.dayNumber]);

  if (!page) return null;
  const runningBalances = purchaseRunningBalances(entries, page.day.totalDebtUnits);
  const emptyCurrentDay = !entries.some(entry => entry.dayId === page.day.id);

  return (
    <div className="purchase-register" ref={registerRef}>
      {page.nextBefore && (
        <button className="purchase-older" onClick={() => void older()} disabled={busy}>
          <ChevronDown size={14} />
          {uiText("تحميل معاملات أقدم")}</button>
      )}
      <PurchaseRegisterHeader />
      {entries.map((entry, index) => {
        return (
          <PurchaseEntryGroup key={entry.id}
            entry={entry} showSeparator={index === 0 || entries[index - 1].dayNumber !== entry.dayNumber}
            showClosing={entry.dayStatus === 'finalized' && entries[index + 1]?.dayId !== entry.dayId}
            balanceBeforeUnits={runningBalances.get(entry.id)?.before ?? null}
            runningBalanceUnits={runningBalances.get(entry.id)?.after ?? null}
            partialOpening={index === 0 && page.nextBefore !== null}
            editing={editingId === entry.id} busy={busy} canWrite={canWrite} canFinalize={canFinalize}
            merchant={merchant} onEdit={async () => {
              if (editingId && editingId !== entry.id && !(await flushBeforeNavigation())) return;
              setEditingId(entry.id);
            }} onRemove={() => void remove(entry)}
            onToggleCorrection={(open) => void toggleCorrection(entry, open)} onMarkDirty={() => markDirty(entry.id)}
            onCancelEditing={cancelEditing} onSaved={async () => { setEditingId(null); await load(merchant, true); }}
            onBusyChange={setBusy} onMessage={setMessage} />
        );
      })}
      {(canWrite || emptyCurrentDay) && (
        <div className={`purchase-day-entry purchase-day-tone-${page.day.dayNumber % 5}`}>
          {emptyCurrentDay && <>
            <div className="purchase-day-separator">
              <span>{uiText('يوم #')}{page.day.dayNumber}</span>
              <b>{page.day.businessDate}</b>
              <em>{uiText('اليوم الحالي')}</em>
            </div>
            <PurchaseCarryRow balance={page.day.previousDebtUnits} />
          </>}
          {canWrite && <PurchaseInlineEditor
            key={`${merchant}:${page.day.dayNumber}`}
            dayVersion={page.day.version}
            balanceBeforeUnits={page.day.totalDebtUnits}
            busy={busy}
            markDirty={markDirty}
            cancel={() => {}}
            saved={async () => {
              await load(merchant, true);
              window.setTimeout(() => document.querySelector<HTMLInputElement>('[data-new-value]')?.focus(), 0);
            }}
            merchant={merchant}
            setBusy={setBusy}
            setMessage={setMessage}
          />}
        </div>
      )}
      <PurchaseRegisterTotals totals={page.registerTotals} />
    </div>
  );
}
