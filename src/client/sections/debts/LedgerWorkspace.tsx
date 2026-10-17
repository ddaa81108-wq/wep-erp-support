import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Ledger, LedgerItem } from '../../api.ts';
import { CustomerDetailsForm } from './CustomerDialogs.tsx';
import { debtSectionText, type DebtSection } from './sectionConfig.ts';
import { cancelSectionTransaction } from './debtSectionApi.ts';
import { ledgerErrorText } from './ledgerModel.ts';
import { LedgerHeader } from './LedgerHeader.tsx';
import { LedgerEntriesTable } from './LedgerEntriesTable.tsx';

type Notice = { kind: 'success' | 'error'; text: string } | null;

export function LedgerWorkspace({
  section,
  ledger,
  canWrite,
  onClose,
  onRefresh,
  onLoadOlder,
  onNotice,
}: {
  section: DebtSection;
  ledger: Ledger;
  canWrite: boolean;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onLoadOlder: () => Promise<void>;
  onNotice: (notice: Notice) => void;
}) {
  const [editing, setEditing] = useState<LedgerItem | null>(null);
  const [newDraftKey, setNewDraftKey] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [busyId, setBusyId] = useState('');
  const finish = async (message: string) => {
    setEditing(null);
    await onRefresh();
    setNewDraftKey((value) => value + 1);
    onNotice({ kind: 'success', text: message });
  };
  const cancel = async (item: LedgerItem) => {
    if (!window.confirm(`إلغاء المعاملة رقم ${item.sequence}؟ ستختفي من السجل المعروض مع الاحتفاظ بها للمراجعة.`)) return;
    setBusyId(item.id);
    try {
      const body = { requestId: crypto.randomUUID(), expectedVersion: ledger.customer.version };
      await cancelSectionTransaction(section, ledger.customer.id, item.id, body);
      await finish('تم إلغاء المعاملة وإخفاؤها من العرض مع حفظ أثرها للمراجعة.');
    } catch (caught) {
      onNotice({ kind: 'error', text: ledgerErrorText(caught) });
    } finally {
      setBusyId('');
    }
  };
  return (
    <motion.aside
      className={`ledger-panel permanent-ledger section-${section}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <LedgerHeader section={section} ledger={ledger} canWrite={canWrite} onClose={onClose}
        onEditDetails={() => setDetailsOpen(true)} />
      <LedgerEntriesTable
        section={section}
        ledger={ledger}
        canWrite={canWrite}
        editing={editing}
        busyId={busyId}
        newDraftKey={newDraftKey}
        onEditingChange={setEditing}
        onCancel={(item) => void cancel(item)}
        onSaved={finish}
        onLoadOlder={onLoadOlder}
        onResetDraft={() => setNewDraftKey((value) => value + 1)}
        onConflict={onRefresh}
      />
      <AnimatePresence>
        {detailsOpen && (
          <CustomerDetailsForm
            section={section}
            ledger={ledger}
            onClose={() => setDetailsOpen(false)}
            onSaved={async () => {
              setDetailsOpen(false);
              await onRefresh();
              onNotice({ kind: 'success', text: `تم تحديث بيانات ${debtSectionText[section].singular}.` });
            }}
          />
        )}
      </AnimatePresence>
    </motion.aside>
  );
}
