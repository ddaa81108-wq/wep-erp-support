import { useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { PurchaseInlineEditor } from './PurchaseInlineEditor.tsx';
import type { usePurchasesPage } from './usePurchasesPage.ts';
import { PurchaseRegisterHeader } from './PurchaseRegisterHeader.tsx';
import { PurchaseEntryGroup } from './PurchaseEntryGroup.tsx';
import { PurchaseRegisterTotals } from './PurchaseRegisterTotals.tsx';

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

  return (
    <div className="purchase-register" ref={registerRef}>
      {page.nextBefore && (
        <button className="purchase-older" onClick={() => void older()} disabled={busy}>
          <ChevronDown size={14} />
          تحميل معاملات أقدم
        </button>
      )}
      <PurchaseRegisterHeader />
      {entries.map((entry, index) => {
        return (
          <PurchaseEntryGroup key={`${entry.id}-${entry.version}-${entry.dayVersion}`}
            entry={entry} showSeparator={index === 0 || entries[index - 1].dayNumber !== entry.dayNumber}
            editing={editingId === entry.id} busy={busy} canWrite={canWrite} canFinalize={canFinalize}
            merchant={merchant} onEdit={() => setEditingId(entry.id)} onRemove={() => void remove(entry)}
            onToggleCorrection={(open) => void toggleCorrection(entry, open)} onMarkDirty={markDirty}
            onCancelEditing={cancelEditing} onSaved={async () => { setEditingId(null); await load(merchant, true); }}
            onBusyChange={setBusy} onMessage={setMessage} />
        );
      })}
      {canWrite && (
        <div className={`purchase-day-entry purchase-day-tone-${page.day.dayNumber % 5}`}>
          <PurchaseInlineEditor
            dayVersion={page.day.version}
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
          />
        </div>
      )}
      <PurchaseRegisterTotals totals={page.registerTotals} />
    </div>
  );
}
