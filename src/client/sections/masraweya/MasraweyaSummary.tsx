import { Camera, Share2 } from 'lucide-react';
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
  openingEditable: boolean;
  busy: boolean;
  onPreviousChange: (value: string) => void;
  onPurchasesChange: (value: string) => void;
  onFlush: () => Promise<boolean>;
};
export function MasraweyaSummary(props: Props) {
  const summaryRef = useRef<HTMLDivElement>(null);
  const [capturing, setCapturing] = useState(false);
  const [message, setMessage] = useState('');
  const mobileSharing = usesMobileSharing();
  async function capture() {
    if (!summaryRef.current || !(await props.onFlush())) return;
    setCapturing(true);
    setMessage('');
    try {
      setMessage(
        captureResultMessage(await captureMasraweyaSummary(summaryRef.current, props.day.businessDate)),
      );
    } catch {
      setMessage('تعذر تجهيز الصورة.');
    } finally {
      setCapturing(false);
    }
  }
  return (
    <section className="masraweya-panel summary-panel">
      <div className="panel-title">
        <div>
          <h2>ملخص اليوم</h2>
          <small>القيم بالجنيه المصري</small>
        </div>
        <button onClick={() => void capture()} disabled={props.busy || capturing}>
          {mobileSharing ? <Share2 size={16} /> : <Camera size={16} />}
          <span>{mobileSharing ? 'مشاركة الصورة' : 'نسخ الصورة'}</span>
        </button>
      </div>
      <div className="masraweya-summary-sheet" ref={summaryRef}>
        <div className="masraweya-summary-date">
          <span>المصراوية</span>
          <time dir="ltr">{props.day.businessDate}</time>
        </div>
        <table aria-label="إجماليات المصراوية">
          <tbody>
            <tr>
              <th scope="row">
                <span>القيمة السابقة</span>
                <small>
                  {props.openingEditable
                    ? 'رصيد بداية العمل'
                    : props.day.carrySourceDate
                      ? `من رصيد ${props.day.carrySourceDate}`
                      : 'رصيد محفوظ'}
                </small>
              </th>
              <td>
                <input
                  aria-label="القيمة السابقة"
                  inputMode="numeric"
                  dir="ltr"
                  readOnly={!props.openingEditable}
                  disabled={props.locked}
                  value={props.previous}
                  onChange={(event) => props.onPreviousChange(event.target.value)}
                />
              </td>
            </tr>
            <tr className="summary-purchases">
              <th scope="row">
                <span>مشتريات اليوم</span>
                <small>أدخل المبلغ هنا</small>
              </th>
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
              <th scope="row">
                <span>إجمالي شغل اليوم</span>
                <small>القيم والعمولات</small>
              </th>
              <td dir="ltr">{masraweyaNumberFormat.format(props.workTotal)}</td>
            </tr>
            <tr className={`final-row ${props.final < 0 ? 'negative' : ''}`}>
              <th scope="row">
                <span>الرصيد المتبقي</span>
                <small>السابق + المشتريات − الشغل</small>
              </th>
              <td dir="ltr">
                <strong>{masraweyaNumberFormat.format(props.final)}</strong>
                <small>ج.م</small>
              </td>
            </tr>
          </tbody>
        </table>
        {props.day.historicalAdjustmentUnits !== 0 && !props.day.openingEditable && (
          <p className="masraweya-legacy-note">
            يتضمن الرصيد فرقًا محفوظًا من النظام السابق:{' '}
            <b dir="ltr">{masraweyaNumberFormat.format(props.day.historicalAdjustmentUnits)}</b> ج.م
          </p>
        )}
      </div>
      {props.day.updatedByName && (
        <small className="operation-actor">آخر إدخال بواسطة {props.day.updatedByName}</small>
      )}
      {message && <small role="status">{message}</small>}
    </section>
  );
}
