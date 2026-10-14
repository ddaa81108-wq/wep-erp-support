import { Check, Pencil, Trash2 } from 'lucide-react';
import type { PurchaseEntry, PurchaseMerchantKey } from '../../api.ts';
import { PurchaseInlineEditor } from './PurchaseInlineEditor.tsx';
import { purchaseNumber } from './purchaseEditorModel.ts';

export function PurchaseEntryGroup({
  entry,
  showSeparator,
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
          <span>يوم #{entry.dayNumber}</span>
          <b>{entry.businessDate}</b>
          <em>{entry.dayStatus === 'finalized' ? entry.correctionOpen ? 'مفتوح للتعديل' : 'مُرحّل' : 'اليوم الحالي'}</em>
          {canFinalize && entry.dayStatus === 'finalized' && (
            <button onClick={() => onToggleCorrection(!entry.correctionOpen)}>
              {entry.correctionOpen ? 'إنهاء تعديل اليوم' : 'تعديل اليوم'}
            </button>
          )}
        </div>
      )}
      {historicalEditing || editing ? (
        <PurchaseInlineEditor entry={entry} dayVersion={entry.dayVersion} busy={busy}
          markDirty={onMarkDirty} cancel={onCancelEditing} saved={onSaved} merchant={merchant}
          setBusy={onBusyChange} setMessage={onMessage} />
      ) : (
        <div className="purchase-grid purchase-row"
          onDoubleClick={() => entry.dayStatus === 'draft' && canWrite && onEdit()}>
          <span data-label="التسلسل">{entry.sequence}</span>
          <span data-label="النوع"><b className="purchase-type-badge" data-kind={entry.itemCode}>{entry.itemLabel}</b>
            {!entry.actorIsOwner && <small className="operation-actor">بواسطة {entry.actorName}</small>}
          </span>
          <span data-label="القيمة ج.م" dir="ltr">{purchaseNumber.format(entry.egpValueUnits)}</span>
          <span data-label="العملية"><b className="purchase-operation-badge" data-mode={entry.calculationMode}>{entry.calculationMode === 'multiply' ? '×' : '÷'}</b></span>
          <span data-label="السعر" dir="ltr">{entry.exchangeRate}</span>
          <span data-label="الناتج" dir="ltr">{purchaseNumber.format(entry.resultUnits)}</span>
          <span data-label="المسدد" dir="ltr">{purchaseNumber.format(entry.paidUnits)}</span>
          <span data-label="الباقي" dir="ltr">{purchaseNumber.format(entry.remainingUnits)}</span>
          <span data-label="مستهلك فودافون" dir="ltr">{purchaseNumber.format(entry.vodafoneConsumedUnits)}</span>
          <span className="purchase-actions">
            {entry.dayStatus === 'finalized' && !entry.correctionOpen && (
              <span className="purchase-saved-mark" role="img" aria-label="تم حفظ المعاملة وترحيل اليوم" title="تم حفظ المعاملة وترحيل اليوم"><Check size={16} /></span>
            )}
            {canWrite && entry.dayStatus === 'draft' && <>
              <button aria-label="تعديل" onClick={onEdit}><Pencil size={13} /></button>
              <button className="danger" aria-label="حذف" onClick={onRemove}><Trash2 size={13} /></button>
            </>}
          </span>
        </div>
      )}
    </div>
  );
}
