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
  const debtLedger = section === 'customers' || section === 'companies' || section === 'libyan-deposits' || section === 'egyptian-deposits';
  const dateParts = ledgerDateFormat.formatToParts(new Date(item.transactionDate));
  const part = (type: Intl.DateTimeFormatPartTypes) => dateParts.find(value => value.type === type)?.value ?? '';
  const movement = isDepositSection(section)
    ? item.type === 'debt'
      ? (section === 'libyan-deposits' ? 'إيداع أمانة' : 'إيداع مصري')
      : (section === 'libyan-deposits' ? 'سحب أمانة' : 'سحب مصري')
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
        {debtLedger ? <strong className="ledger-date-parts">
          <span>{part('weekday')}</span>
          <span dir="ltr">{part('day')}/{part('month')}/{part('year')}</span>
          <span>{part('hour')}:{part('minute')} {part('dayPeriod')}</span>
        </strong> : <strong>{ledgerDateFormat.format(new Date(item.transactionDate))}</strong>}
        {!item.actorIsOwner && <small className="operation-actor" title={`بواسطة ${item.actorName}`}>بواسطة {item.actorName}</small>}
      </div>
      <span className="ledger-cell" data-label="نوع الحركة">
        {debtLedger ? <span className={`ledger-record-pill choice-${item.type === 'debt' ? 'debt' : item.paymentMode === 'full' ? 'full' : 'partial'}`}>
          {isDepositSection(section) ? movement : item.type === 'debt' ? 'ديون' : item.paymentMode === 'full' ? 'دفع كلي' : 'دفع جزئي'}
        </span> : movement}
        {status}
      </span>
      <span className="ledger-cell ledger-statement" data-label="البيان">
        {((section === 'customers' || section === 'companies') ? item.displayNote ?? item.note : item.note) || '—'}
      </span>
      <span className="ledger-cell" data-label="القيمة">
        {ledgerMoney.format(item.inputValue)}
      </span>
      <span className="ledger-cell" data-label="العملية">
        {debtLedger ? <span className={`ledger-record-pill choice-${item.calculationMode}`} title={item.calculationMode === 'direct' ? 'مباشر' : item.calculationMode === 'multiply' ? 'ضرب' : 'قسمة'}>
          {item.calculationMode === 'direct' ? 'مباشر' : item.calculationMode === 'multiply' ? '×' : '÷'}
        </span> : item.calculationMode === 'direct' ? 'مباشر' : item.calculationMode === 'multiply' ? 'ضرب' : 'قسمة'}
      </span>
      <span className="ledger-cell" data-label={(section === 'customers' || section === 'companies' || section === 'libyan-deposits' || section === 'egyptian-deposits') ? 'السعر' : 'المعامل'}>
        {item.factorMicros ? ledgerFactor.format(item.factorMicros / 1_000_000) : '—'}
      </span>
      <strong className="ledger-cell" data-label={section === 'egyptian-deposits' ? 'إيداع مصري' : section === 'libyan-deposits' ? 'إيداع أمانة' : 'دين مضاف'}>
        {item.type === 'debt' ? `${ledgerMoney.format(item.amountUnits)} ${currencyLabel(section)}` : '—'}
      </strong>
      <strong className="ledger-cell" data-label={section === 'egyptian-deposits' ? 'سحب مصري' : section === 'libyan-deposits' ? 'سحب أمانة' : 'مدفوع'}>
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
