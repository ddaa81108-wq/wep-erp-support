import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { api } from '../../api.ts';

export function EgyptianRateCard({ canWrite }: { canWrite: boolean }) {
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('إجمالي الأمانات المصرية ÷ السعر = القيمة الليبية في الخزينة');
  useEffect(() => { api.egyptianDepositRate().then((result) => { setSaved(result.egpPerLyd); setValue(result.egpPerLyd ? String(result.egpPerLyd) : ''); }).catch(() => setMessage('تعذر تحميل السعر')); }, []);
  async function save() {
    const rate = Number(value); if (!(rate > 0)) { setMessage('أدخل سعرًا موجبًا'); return; }
    setBusy(true);
    try { const result = await api.setEgyptianDepositRate(rate); setSaved(result.egpPerLyd); setMessage('تم اعتماد السعر للخزينة'); }
    catch { setMessage('تعذر حفظ السعر'); } finally { setBusy(false); }
  }
  return <article className="exchange-rate-card">
    <div className="rate-card-head"><strong>سعر تحويل إجمالي المصري للخزينة</strong><small>{saved ? `السعر المعتمد: ${saved} ج.م لكل 1 د.ل` : message}</small></div>
    <div className="rate-editor" dir="rtl">
      <span className="rate-unit">1 د.ل</span><span className="rate-equals">=</span>
      <input aria-label="سعر الجنيه المصري لكل دينار ليبي" type="number" min="0.000001" step="any" value={value} onChange={(event) => setValue(event.target.value)} disabled={!canWrite} />
      <span className="rate-unit">ج.م</span>
      {canWrite && <button type="button" onClick={() => void save()} disabled={busy}><Save size={13} /><span>{busy ? 'جارٍ…' : 'حفظ'}</span></button>}
    </div>
  </article>;
}
