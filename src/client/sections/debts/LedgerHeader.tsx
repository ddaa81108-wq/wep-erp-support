import { uiText } from '../../i18n/language.ts';
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
    <header className={canWrite ? undefined : 'ledger-header-readonly'}>
      <button className="icon-button" onClick={onClose} aria-label={uiText("إغلاق السجل")}>
        <X />
      </button>
      <div className="ledger-customer-title">
        <span>{debtSectionText[section].ledgerTitle}</span>
        <h2 title={ledger.customer.name}>{ledger.customer.name}</h2>
      </div>
      {canWrite && (
        <button className="secondary ledger-edit-details" onClick={onEditDetails} aria-label={uiText('تعديل البيانات')} title={uiText('تعديل البيانات')}>
          <Pencil size={16} />
          <span className="ledger-edit-label">{uiText("تعديل البيانات")}</span></button>
      )}
    </header>
  );
}
