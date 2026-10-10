import { ArrowDownToLine, Camera, Check, Pencil, Share2 } from 'lucide-react';
import { useRef, useState } from 'react';
import type { MasraweyaDay } from '../../api.ts';
import { captureMasraweyaSummary, captureResultMessage, usesMobileSharing } from './masraweyaCapture.ts';
import { masraweyaNumberFormat } from './masraweyaModel.ts';

type Props = {
  day: MasraweyaDay;
  previous: string;
  purchases: string;
  workTotal: number;
  final: number;
  locked: boolean;
  busy: boolean;
  onPreviousChange: (value: string) => void;
  onPurchasesChange: (value: string) => void;
  onApplyCarry: () => void;
  onBusyChange: (value: boolean) => void;
  onMessageChange: (value: string) => void;
};

export function MasraweyaSummary(props: Props) {
  const summaryRef = useRef<HTMLDivElement>(null);
  const [editingPrevious, setEditingPrevious] = useState(false);
  const mobileSharing = usesMobileSharing();

  async function capture() {
    if (!summaryRef.current) return;
    props.onBusyChange(true);
    props.onMessageChange('');
    try {
      const result = await captureMasraweyaSummary(summaryRef.current, props.day.businessDate);
      props.onMessageChange(captureResultMessage(result));
    } catch {
      props.onMessageChange('تعذر تجهيز الصورة.');
    } finally {
      props.onBusyChange(false);
    }
  }

  return (
    <section className="masraweya-panel summary-panel">
      <div className="panel-title">
        <div>
          <h2>ملخص اليوم</h2>
          <small>الصورة تشمل الجدول التالي فقط</small>
          {props.day.updatedByName && !props.day.updatedByIsOwner && (
            <small className="operation-actor">آخر تعديل بواسطة {props.day.updatedByName}</small>
          )}
        </div>
        <button onClick={() => void capture()} disabled={props.busy}>
          {mobileSharing ? <Share2 size={16} /> : <Camera size={16} />}
          <span>{mobileSharing ? 'مشاركة الصورة' : 'نسخ الصورة'}</span>
        </button>
      </div>
      <div ref={summaryRef} className="masraweya-capture">
        <table>
          <tbody>
            <tr>
              <th>القيمة السابقة</th>
              <td>
                <input
                  aria-label="القيمة السابقة"
                  inputMode="numeric"
                  dir="ltr"
                  disabled={props.locked || !editingPrevious}
                  value={props.previous}
                  onChange={(event) => props.onPreviousChange(event.target.value)}
                />
                {!props.locked && <button
                  type="button"
                  className="carry-edit-button"
                  title={editingPrevious ? 'تأكيد القيمة السابقة' : 'تعديل القيمة السابقة'}
                  onClick={() => setEditingPrevious((value) => !value)}
                >{editingPrevious ? <><Check size={14} /> تأكيد</> : <><Pencil size={14} /> تعديل</>}</button>}
              </td>
            </tr>
            <tr>
              <th>مشتريات اليوم</th>
              <td>
                <input
                  aria-label="مشتريات اليوم"
                  inputMode="numeric"
                  dir="ltr"
                  disabled={props.locked}
                  value={props.purchases}
                  onChange={(event) => props.onPurchasesChange(event.target.value)}
                />
              </td>
            </tr>
            <tr>
              <th>إجمالي شغل اليوم</th>
              <td dir="ltr">{masraweyaNumberFormat.format(props.workTotal)}</td>
            </tr>
            <tr className="final-row">
              <th>الناتج النهائي</th>
              <td dir="ltr">{masraweyaNumberFormat.format(props.final)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {!props.locked && props.day.carrySourceDate && (
        <button className="carry-button" onClick={props.onApplyCarry}>
          <ArrowDownToLine size={18} />
          <span>ترحيل يدوي من {props.day.carrySourceDate}</span>
          <strong dir="ltr">{masraweyaNumberFormat.format(props.day.carryValueUnits ?? 0)} ج.م</strong>
        </button>
      )}
    </section>
  );
}
