import { useState } from 'react';
import { api, type PurchaseMerchantKey, type PurchasesPage } from '../../api.ts';
import { purchaseErrorText } from './purchaseEditorModel.ts';

type Props = {
  page: PurchasesPage;
  merchant: PurchaseMerchantKey;
  reload: () => Promise<void>;
  setMessage: (value: string) => void;
};

export function PurchaseOpening({ page, merchant, reload, setMessage }: Props) {
  const [debt, setDebt] = useState(String(page.day.previousDebtUnits));
  const [vodafone, setVodafone] = useState(String(page.day.previousVodafoneUnits));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api.setPurchaseOpening(merchant, {
        expectedDayVersion: page.day.version,
        previousDebtUnits: Number(debt || 0),
        previousVodafoneUnits: Number(vodafone || 0),
      });
      await reload();
      setMessage('تم حفظ قيم البداية.');
    } catch (error) {
      setMessage(purchaseErrorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="purchase-opening">
      <strong>ضبط البداية لأول تشغيل فقط</strong>
      <label>
        القيمة السابقة
        <input
          dir="ltr"
          inputMode="numeric"
          value={debt}
          onChange={(event) => setDebt(event.target.value.replace(/[^0-9-]/g, ''))}
        />
      </label>
      <label>
        فودافون المرحّل
        <input
          dir="ltr"
          inputMode="numeric"
          value={vodafone}
          onChange={(event) => setVodafone(event.target.value.replace(/[^0-9-]/g, ''))}
        />
      </label>
      <button disabled={busy} onClick={() => void save()}>
        حفظ البداية
      </button>
    </div>
  );
}
