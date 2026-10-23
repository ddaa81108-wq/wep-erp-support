import { uiText } from '../../i18n/language.ts';
import { Check, Pencil, Trash2 } from 'lucide-react';
import type { PurchaseEntry, PurchaseMerchantKey } from '../../api.ts';
import { PurchaseInlineEditor } from './PurchaseInlineEditor.tsx';
import { purchaseNumber } from './purchaseEditorModel.ts';
import { PurchaseCarryRow } from './PurchaseCarryRow.tsx';

export function PurchaseEntryGroup({
  entry,
  showSeparator,
  showClosing,
  balanceBeforeUnits,
  runningBalanceUnits,
  partialOpening,
  editing,
  busy,
  canWrite,
  canFinalize,
  merchant,
  onEdit,
  onRemove,
  onToggleCorrection,
  onMarkDirty,
  onCancelEditing,
  onSaved,
  onBusyChange,
  onMessage,
}: {
  entry: PurchaseEntry;
  showSeparator: boolean;
  showClosing: boolean;
  balanceBeforeUnits: number | null;
  runningBalanceUnits: number | null;
  partialOpening: boolean;
  editing: boolean;
  busy: boolean;
  canWrite: boolean;
  canFinalize: boolean;
  merchant: PurchaseMerchantKey;
  onEdit: () => void;
  onRemove: () => void;
  onToggleCorrection: (open: boolean) => void;
  onMarkDirty: () => void;
  onCancelEditing: () => void;
  onSaved: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
  onMessage: (message: string) => void;
}) {
  const historicalEditing = entry.dayStatus === 'finalized' && entry.correctionOpen;
  return (
    <div className={`purchase-day-entry purchase-day-tone-${entry.dayNumber % 5}`}>
      {showSeparator && (
        <div className="purchase-day-separator">
          <span>{uiText("يوم #")}{entry.dayNumber}</span>
          <b>{entry.businessDate}</b>
          <em>{entry.dayStatus === 'finalized' ? entry.correctionOpen ? uiText("مفتوح للتعديل") : uiText("مُرحّل") : uiText("اليوم الحالي")}</em>
          {canFinalize && entry.dayStatus === 'finalized' && (
            <button onClick={() => onToggleCorrection(!entry.correctionOpen)}>
              {entry.correctionOpen ? uiText("إنهاء تعديل اليوم") : uiText("تعديل اليوم")}
            </button>
          )}
        </div>
      )}
      {showSeparator && <PurchaseCarryRow balance={balanceBeforeUnits} partial={partialOpening} />}
      {historicalEditing || editing ? (
        <PurchaseInlineEditor entry={entry} dayVersion={entry.dayVersion} balanceBeforeUnits={balanceBeforeUnits} busy={busy}
          markDirty={onMarkDirty} cancel={onCancelEditing} saved={onSaved} merchant={merchant}
          setBusy={onBusyChange} setMessage={onMessage} />
      ) : (
        <div className="purchase-grid purchase-row"
          onDoubleClick={() => entry.dayStatus === 'draft' && canWrite && onEdit()}>
          <span data-label={uiText("التسلسل")}>{entry.sequence}</span>
          <span data-label={uiText("النوع")}><b className="purchase-type-badge" data-kind={entry.itemCode} title={entry.itemCode === 'custom' ? entry.itemLabel : uiText(entry.itemLabel)}>{entry.itemCode === 'custom' ? entry.itemLabel : uiText(entry.itemLabel)}</b>
            {!entry.actorIsOwner && <small className="operation-actor" title={uiText("بواسطة {0}", [entry.actorName])}>{uiText("بواسطة ")}{entry.actorName}</small>}
          </span>
          <span data-label={uiText("القيمة ج.م")} dir="ltr">{purchaseNumber.format(entry.egpValueUnits)}</span>
          <span data-label={uiText("العملية")}><b className="purchase-operation-badge" data-mode={entry.calculationMode}>{entry.calculationMode === 'multiply' ? '×' : '÷'}</b></span>
          <span data-label={uiText("السعر")} dir="ltr">{entry.exchangeRate}</span>
          <span data-label={uiText("الناتج")} dir="ltr">{purchaseNumber.format(entry.resultUnits)}</span>
          <span data-label={uiText("المسدد")} dir="ltr">{purchaseNumber.format(entry.paidUnits)}</span>
          <span className="purchase-running-balance" data-label={uiText("الباقي")} title={uiText('الرصيد التراكمي بعد المعاملة')} dir="ltr">{runningBalanceUnits === null ? '—' : purchaseNumber.format(runningBalanceUnits)}</span>
          <span data-label={uiText("مستهلك فودافون")} dir="ltr">{purchaseNumber.format(entry.vodafoneConsumedUnits)}</span>
          <span className="purchase-actions">
            {entry.dayStatus === 'finalized' && !entry.correctionOpen && (
              <span className="purchase-saved-mark" role="img" aria-label={uiText("تم حفظ المعاملة وترحيل اليوم")} title={uiText("تم حفظ المعاملة وترحيل اليوم")}><Check size={16} /></span>
            )}
            {canWrite && entry.dayStatus === 'draft' && <>
              <button aria-label={uiText("تعديل")} onClick={onEdit}><Pencil size={13} /></button>
              <button className="danger" aria-label={uiText("حذف")} onClick={onRemove}><Trash2 size={13} /></button>
            </>}
          </span>
        </div>
      )}
      {showClosing && Number.isFinite(entry.dayClosingDebtUnits) && (
        <div className="purchase-grid purchase-day-closing" data-day-id={entry.dayId}>
          <span className="purchase-day-closing-label">{uiText("الباقي المُرحّل لليوم التالي — يوم #")}{entry.dayNumber}</span>
          <strong className="purchase-day-closing-value" dir="ltr" aria-label={uiText("الباقي المرحل لليوم {0}", [entry.dayNumber])}>
            {purchaseNumber.format(entry.dayClosingDebtUnits)}
          </strong>
        </div>
      )}
    </div>
  );
}
