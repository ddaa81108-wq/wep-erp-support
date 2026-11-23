import { Ban, Check } from 'lucide-react';
import type { CollectionPayrollEntry } from '../../apiTypes.ts';
import { uiText } from '../../i18n/language.ts';
import { collectionMoney } from './useCollectionsDashboard.ts';
import '../../styles/payroll-cancellation.css';

export function PayrollEntryRow({ entry, isAdmin, busy, onConfirm, onCancel }: {
  entry: CollectionPayrollEntry; isAdmin: boolean; busy: boolean;
  onConfirm: (id: string) => void; onCancel: (entry: CollectionPayrollEntry) => void;
}) {
  return <article data-payroll-entry-id={entry.id} className={entry.kind === 'withdrawal' ? 'payroll-withdrawal' : 'payroll-commission'}>
    <div><strong>{entry.kind === 'withdrawal' ? uiText('سحب') : uiText('عمولة / مكافأة')}</strong><span>{entry.reason}</span></div>
    <b>{collectionMoney.format(entry.amountUnits)} {uiText('د.ل')}</b>
    <small>{entry.createdByName} • {new Date(entry.createdAt).toLocaleString('ar-EG')}</small>
    <div className="payroll-entry-status">
      {entry.confirmedAt ? <em><Check size={13} />{uiText('تم التأكيد')}</em>
          : isAdmin ? <em className="pending-confirmation">{uiText('بانتظار تأكيد الموظف')}</em>
            : <button className="confirm-payroll" disabled={busy} onClick={() => onConfirm(entry.id)}><Check size={14} />{uiText('تأكيد الاستلام')}</button>}
          {isAdmin && <button type="button" className="cancel-payroll-entry" disabled={busy} onClick={() => onCancel(entry)}><Ban size={13} />{uiText('إلغاء المعاملة')}</button>}
    </div>
  </article>;
}
