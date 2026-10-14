import { Pencil, X } from 'lucide-react';
import type { LedgerItem } from '../../api.ts';
import { currencyLabel, isDepositSection } from './debtSectionUtils.ts';
import { ledgerDateFormat, ledgerMoney, ledgerFactor } from './ledgerModel.ts';
import type { DebtSection } from './sectionConfig.ts';

type Props = {
  section: DebtSection;
  item: LedgerItem;
  balanceAfter: number;
  canWrite: boolean;
  busy: boolean;
  onEdit: () => void;
  onCancel: () => void;
};

export function LedgerRecordRow({ section, item, balanceAfter, canWrite, busy, onEdit, onCancel }: Props) {
  const editable = canWrite && item.status === 'posted';
  const movement = isDepositSection(section)
    ? item.type === 'debt'
      ? 'دخول'
      : 'خروج'
    : item.type === 'debt'
      ? 'إضافة دين'
      : item.paymentMode === 'full'
        ? 'سداد كامل'
        : 'سداد جزئي';
  const status = item.status === 'corrected' ? ' — مصححة' : item.status === 'reversed' ? ' — ملغاة' : '';

  return (
    <div data-ledger-row tabIndex={0} className={`ledger-grid ledger-record ${item.type} ${item.status}`}>
      <b className="ledger-cell" data-label="التسلسل">
        #{item.sequence}
      </b>
      <div className="ledger-cell" data-label="اليوم والتاريخ والوقت">
        <strong>{ledgerDateFormat.format(new Date(item.transactionDate))}</strong>
        {!item.actorIsOwner && <small className="operation-actor" title={`بواسطة ${item.actorName}`}>بواسطة {item.actorName}</small>}
      </div>
      <span className="ledger-cell" data-label="نوع الحركة">
        {(section === 'customers' || section === 'companies') ? item.type === 'debt' ? 'ديون' : item.paymentMode === 'full' ? 'دفع كلي' : 'دفع جزئي' : movement}
        {status}
      </span>
      <span className="ledger-cell ledger-statement" data-label="البيان">
        {item.note || '—'}
      </span>
      <span className="ledger-cell" data-label="القيمة">
        {ledgerMoney.format(item.inputValue)}
      </span>
      <span className="ledger-cell" data-label="العملية">
        {item.calculationMode === 'direct' ? 'مباشر' : item.calculationMode === 'multiply' ? 'ضرب' : 'قسمة'}
      </span>
      <span className="ledger-cell" data-label={(section === 'customers' || section === 'companies') ? 'السعر' : 'المعامل'}>
        {item.factorMicros ? ledgerFactor.format(item.factorMicros / 1_000_000) : '—'}
      </span>
      <strong className="ledger-cell" data-label="دين مضاف">
        {item.type === 'debt' ? `${ledgerMoney.format(item.amountUnits)} ${currencyLabel(section)}` : '—'}
      </strong>
      <strong className="ledger-cell" data-label="مدفوع">
        {item.type === 'payment' ? `${ledgerMoney.format(item.amountUnits)} ${currencyLabel(section)}` : '—'}
      </strong>
      <strong className="ledger-cell ledger-row-balance" data-label="الرصيد">
        {ledgerMoney.format(balanceAfter)} {currencyLabel(section)}
      </strong>
      {editable ? (
        <button className="row-action edit" aria-label={`تعديل المعاملة ${item.sequence}`} onClick={onEdit}>
          <Pencil size={16} />
        </button>
      ) : (
        <span className="row-action-placeholder" />
      )}
      {editable ? (
        <button
          className="row-action cancel"
          aria-label={`إلغاء المعاملة ${item.sequence}`}
          disabled={busy}
          onClick={onCancel}
        >
          <X size={17} />
        </button>
      ) : (
        <span className="row-action-placeholder" />
      )}
    </div>
  );
}
