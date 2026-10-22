import { direction, uiText } from '../../i18n/language.ts';
import { useRealtimeRefresh } from '../../realtime/useRealtimeRefresh.ts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Save } from 'lucide-react';
import { api } from '../../api.ts';

export function EgyptianRateCard({ canWrite }: { canWrite: boolean }) {
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(uiText("إجمالي الأمانات المصرية ÷ السعر = القيمة الليبية في الخزينة"));
  const dirty = useRef(false);
  const load = useCallback(async () => {
    const result = await api.egyptianDepositRate();
    setSaved(result.egpPerLyd);
    if (!dirty.current) setValue(result.egpPerLyd ? String(result.egpPerLyd) : '');
  }, []);
  useEffect(() => { void load().catch(() => setMessage(uiText("تعذر تحميل السعر"))); }, [load]);
  useRealtimeRefresh({ topics: ['egyptian-deposit.changed'], cursorKey: 'abdo:egyptian-rate-events', onChange: load });

  async function save() {
    const rate = Number(value); if (!(rate > 0)) { setMessage(uiText("أدخل سعرًا موجبًا")); return; }
    setBusy(true);
    try { const result = await api.setEgyptianDepositRate(rate); dirty.current = false; setSaved(result.egpPerLyd); setMessage(uiText("تم اعتماد السعر للخزينة")); }
    catch { setMessage(uiText("تعذر حفظ السعر")); } finally { setBusy(false); }
  }
  return <article className="exchange-rate-card">
    <div className="rate-card-head"><strong>{uiText("سعر تحويل إجمالي المصري للخزينة")}</strong><small>{saved ? uiText("السعر المعتمد: {0} ج.م لكل 1 د.ل", [saved]) : message}</small></div>
    <div className="rate-editor" dir={direction}>
      <span className="rate-unit">{uiText("1 د.ل")}</span><span className="rate-equals">=</span>
      <input aria-label={uiText("سعر الجنيه المصري لكل دينار ليبي")} type="number" min="0.000001" step="any" value={value} onChange={(event) => { dirty.current = true; setValue(event.target.value); }} disabled={!canWrite} />
      <span className="rate-unit">{uiText("ج.م")}</span>
      {canWrite && <button type="button" onClick={() => void save()} disabled={busy}><Save size={13} /><span>{busy ? uiText("جارٍ…") : uiText("حفظ")}</span></button>}
    </div>
  </article>;
}
