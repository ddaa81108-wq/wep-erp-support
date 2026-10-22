import { uiText } from '../../i18n/language.ts';
import { ledgerDisplayDates } from './ledgerDisplayDates.ts';
import { useMinuteClock } from '../../useMinuteClock.ts';
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
  const now = useMinuteClock();
  const editable = canWrite && item.status === 'posted';
  const debtLedger = section === 'customers' || section === 'companies' || section === 'libyan-deposits' || section === 'egyptian-deposits';
  const dates = ledgerDisplayDates(item.transactionDate, item.createdAt);
  const movement = isDepositSection(section)
    ? item.type === 'debt'
      ? (section === 'libyan-deposits' ? uiText("إيداع أمانة") : uiText("إيداع مصري"))
      : (section === 'libyan-deposits' ? uiText("سحب أمانة") : uiText("سحب مصري"))
    : item.type === 'debt'
      ? uiText("إضافة دين")
      : item.paymentMode === 'full'
        ? uiText("سداد كامل")
        : uiText("سداد جزئي");
  const status = item.status === 'corrected' ? uiText(" — مصححة") : item.status === 'reversed' ? uiText(" — ملغاة") : '';
  const updatedAt = Date.parse(item.updatedAt ?? item.createdAt);
  const createdAt = Date.parse(item.createdAt);
  const recentlyEdited = Number.isFinite(updatedAt) && Number.isFinite(createdAt) && updatedAt > createdAt && now >= updatedAt && now - updatedAt <= 24 * 60 * 60 * 1000;

  return (
    <div data-ledger-row tabIndex={0} className={`ledger-grid ledger-record ${item.type} ${item.status}`}>
      <b className="ledger-cell" data-label={uiText("التسلسل")}>
        #{item.sequence}
        {recentlyEdited && <span className="ledger-recent-edit" title={uiText("تم تعديل المعاملة خلال آخر 24 ساعة")}>{uiText("معدّل")}</span>}
      </b>
      <div className="ledger-cell" data-label={uiText("اليوم والتاريخ والوقت")}>
        {debtLedger ? <strong className="ledger-date-parts">
          <span title={uiText("يوم الحركة المحاسبي")}>{dates.weekday}</span>
          <span dir="ltr" title={uiText("تاريخ الحركة المحاسبي")}>{dates.date}</span>
          <span title={dates.recordingTitle} aria-label={dates.recordingTitle}>{uiText("تسجيل ")}{dates.time}</span>
        </strong> : <strong>{ledgerDateFormat.format(new Date(item.transactionDate))}</strong>}
        {!item.actorIsOwner && <small className="operation-actor" title={uiText("بواسطة {0}", [item.actorName])}>{uiText("بواسطة ")}{item.actorName}</small>}
      </div>
      <span className="ledger-cell" data-label={uiText("نوع الحركة")}>
        {debtLedger ? <span className={`ledger-record-pill choice-${item.type === 'debt' ? 'debt' : item.paymentMode === 'full' ? 'full' : 'partial'}`}>
          {isDepositSection(section) ? movement : item.type === 'debt' ? uiText("ديون") : item.paymentMode === 'full' ? uiText("دفع كلي") : uiText("دفع جزئي")}
        </span> : movement}
        {status}
      </span>
      <span className="ledger-cell ledger-statement" data-label={uiText("البيان")}>
        {((section === 'customers' || section === 'companies') ? item.displayNote ?? item.note : item.note) || '—'}
      </span>
      <span className="ledger-cell" data-label={uiText("القيمة")}>
        <span className="ledger-readable-value" tabIndex={0} data-preview={`${ledgerMoney.format(item.inputValue)} ${currencyLabel(section)}`}>
          {ledgerMoney.format(item.inputValue)}
        </span>
      </span>
      <span className="ledger-cell" data-label={uiText("العملية")}>
        {debtLedger ? <span className={`ledger-record-pill choice-${item.calculationMode}`} title={item.calculationMode === 'direct' ? uiText("مباشر") : item.calculationMode === 'multiply' ? uiText("ضرب") : uiText("قسمة")}>
          {item.calculationMode === 'direct' ? uiText("مباشر") : item.calculationMode === 'multiply' ? '×' : '÷'}
        </span> : item.calculationMode === 'direct' ? uiText("مباشر") : item.calculationMode === 'multiply' ? uiText("ضرب") : uiText("قسمة")}
      </span>
      <span className="ledger-cell" data-label={(section === 'customers' || section === 'companies' || section === 'libyan-deposits' || section === 'egyptian-deposits') ? uiText("السعر") : uiText("المعامل")}>
        {item.factorMicros ? ledgerFactor.format(item.factorMicros / 1_000_000) : '—'}
      </span>
      <strong className="ledger-cell" data-label={section === 'egyptian-deposits' ? uiText("إيداع مصري") : section === 'libyan-deposits' ? uiText("إيداع أمانة") : uiText("دين مضاف")}>
        <span className="ledger-readable-value" tabIndex={0} data-preview={item.type === 'debt' ? `${ledgerMoney.format(item.amountUnits)} ${currencyLabel(section)}` : '—'}>
          {item.type === 'debt' ? `${ledgerMoney.format(item.amountUnits)} ${currencyLabel(section)}` : '—'}
        </span>
      </strong>
      <strong className="ledger-cell" data-label={section === 'egyptian-deposits' ? uiText("سحب مصري") : section === 'libyan-deposits' ? uiText("سحب أمانة") : uiText("مدفوع")}>
        <span className="ledger-readable-value" tabIndex={0} data-preview={item.type === 'payment' ? `${ledgerMoney.format(item.amountUnits)} ${currencyLabel(section)}` : '—'}>
          {item.type === 'payment' ? `${ledgerMoney.format(item.amountUnits)} ${currencyLabel(section)}` : '—'}
        </span>
      </strong>
      <strong className="ledger-cell ledger-row-balance" data-label={uiText("الرصيد")}>
        <span className="ledger-readable-value" tabIndex={0} data-preview={`${ledgerMoney.format(balanceAfter)} ${currencyLabel(section)}`}>
          {ledgerMoney.format(balanceAfter)} {currencyLabel(section)}
        </span>
      </strong>
      {editable ? (
        <button className="row-action edit" aria-label={uiText("تعديل المعاملة {0}", [item.sequence])} onClick={onEdit}>
          <Pencil size={16} />
        </button>
      ) : (
        <span className="row-action-placeholder" />
      )}
      {editable ? (
        <button
          className="row-action cancel"
          aria-label={uiText("إلغاء المعاملة {0}", [item.sequence])}
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
