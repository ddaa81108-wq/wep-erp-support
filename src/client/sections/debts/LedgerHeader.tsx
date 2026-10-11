import { Pencil, X } from 'lucide-react';
import type { Ledger } from '../../api.ts';
import { debtSectionText, type DebtSection } from './sectionConfig.ts';

export function LedgerHeader({
  section,
  ledger,
  canWrite,
  onClose,
  onEditDetails,
}: {
  section: DebtSection;
  ledger: Ledger;
  canWrite: boolean;
  onClose: () => void;
  onEditDetails: () => void;
}) {
  return (
    <header>
      <button className="icon-button" onClick={onClose} aria-label="إغلاق السجل">
        <X />
      </button>
      <div className="ledger-customer-title">
        <span>{debtSectionText[section].ledgerTitle}</span>
        <h2 title={ledger.customer.name}>{ledger.customer.name}</h2>
      </div>
      {canWrite && (
        <button className="secondary ledger-edit-details" onClick={onEditDetails}>
          <Pencil size={16} />
          تعديل البيانات
        </button>
      )}
    </header>
  );
}
