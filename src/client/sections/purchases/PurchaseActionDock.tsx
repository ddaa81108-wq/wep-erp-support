import { CheckCircle2, Plus } from 'lucide-react';
import type { PurchaseMerchantKey } from '../../api.ts';

type Props = {
  merchant: PurchaseMerchantKey;
  busy: boolean;
  canWrite: boolean;
  canFinalize: boolean;
  dayNumber: number;
  selectMerchant: (merchant: PurchaseMerchantKey) => void;
  finalize: () => Promise<void>;
};

export function PurchaseActionDock({
  merchant,
  busy,
  canWrite,
  canFinalize,
  dayNumber,
  selectMerchant,
  finalize,
}: Props) {
  return (
    <div className="purchase-action-dock" aria-label="أدوات قسم المشتريات">
      <div className="purchase-head-actions">
        <span className="purchase-dock-day">يوم #{dayNumber}</span>
        <div className="merchant-tabs">
          <button
            className={merchant === 'al_bayan' ? 'active' : ''}
            onClick={() => selectMerchant('al_bayan')}
          >
            البيان
          </button>
          <button
            className={merchant === 'simsim' ? 'active' : ''}
            onClick={() => selectMerchant('simsim')}
          >
            سمسم
          </button>
        </div>
        {canWrite && (
          <button onClick={() => document.querySelector<HTMLInputElement>('[data-new-value]')?.focus()}>
            <Plus size={15} />
            إضافة معاملة
          </button>
        )}
        {canFinalize && (
          <button className="finalize" onClick={() => void finalize()} disabled={busy}>
            <CheckCircle2 size={15} />
            ترحيل اليوم
          </button>
        )}
      </div>
    </div>
  );
}
