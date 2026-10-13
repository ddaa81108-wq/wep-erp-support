import { useEffect, useState } from 'react';
import { request } from '../apiTransport.ts';
import type { LiveActivity, DailyActivity } from '../../server/db/databaseActivity.ts';
import './database-activity.css';
const number = (value: number) => new Intl.NumberFormat('ar-LY', { maximumFractionDigits: 2 }).format(value);
const tripoliDay = (value = Date.now()) => new Date(value + 7200000).toISOString().slice(0, 10);
const time = (value: number) =>
  new Intl.DateTimeFormat('ar-LY', { timeStyle: 'medium', timeZone: 'Africa/Tripoli' }).format(value);
type ChartPoint = { x: number; a: number | null; b: number | null; label: string };
function LineChart({
  points,
  label,
  first,
  second,
  unit,
}: {
  points: ChartPoint[];
  label: string;
  first: string;
  second: string;
  unit: string;
}) {
  const width = 900,
    height = 210,
    pad = 40;
  const max = Math.max(1, ...points.flatMap((p) => [p.a ?? 0, p.b ?? 0]));
  const minX = points[0]?.x ?? 0;
  const maxX = points.at(-1)?.x ?? minX + 1;
  const x = (value: number) => pad + ((value - minX) / Math.max(1, maxX - minX)) * (width - pad - 12);
  const y = (value: number) => height - 28 - (value / max) * (height - 55);
  function path(key: 'a' | 'b') {
    let connected = false;
    let previousX = 0;
    return points
      .map((point) => {
        const value = point[key];
        if (value === null) {
          connected = false;
          return '';
        }
        const command = connected && point.x - previousX <= (maxX > 1000000000000 ? 2100 : 1.1) ? 'L' : 'M';
        connected = true;
        previousX = point.x;
        return `${command}${x(point.x)},${y(value)}`;
      })
      .join(' ');
  }
  return (
    <>
      <div className="activity-legend">
        <span className="activity-read">● {first}</span>
        <span className="activity-write">● {second}</span>
        <span>{unit}</span>
      </div>
      <svg className="activity-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
        <title>{label}</title>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad} x2={width - 12} y1={y(max * f)} y2={y(max * f)} className="activity-grid" />
            <text x={pad - 6} y={y(max * f) + 4} textAnchor="end">
              {number(max * f)}
            </text>
          </g>
        ))}
        <path d={path('a')} className="activity-read-line" />
        <path d={path('b')} className="activity-write-line" />
        {points.map((p, index) => (
          <g key={p.x}>
            {p.a !== null && (
              <circle cx={x(p.x)} cy={y(p.a)} r="2" className="activity-read-dot">
                <title>
                  {p.label}: {first} {number(p.a)}
                </title>
              </circle>
            )}
            {p.b !== null && (
              <circle cx={x(p.x)} cy={y(p.b)} r="2" className="activity-write-dot">
                <title>
                  {p.label}: {second} {number(p.b)}
                </title>
              </circle>
            )}
            {(index === 0 || index === points.length - 1 || index === Math.floor(points.length / 2)) && (
              <text
                x={x(p.x)}
                y={height - 5}
                textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}
              >
                {p.label}
              </text>
            )}
          </g>
        ))}
      </svg>
    </>
  );
}
export function DatabaseActivity() {
  const [initialTime] = useState(Date.now);
  const [live, setLive] = useState<LiveActivity | null>(null);
  const [daily, setDaily] = useState<DailyActivity | null>(null);
  const [day, setDay] = useState(tripoliDay);
  const [liveError, setLiveError] = useState('');
  const [dailyError, setDailyError] = useState('');
  useEffect(() => {
    let disposed = false,
      running = false;
    async function refresh() {
      if (running || document.hidden) return;
      running = true;
      try {
        const value = await request<LiveActivity>('/api/operations/database-activity/live');
        if (!disposed) {
          setLive(value);
          setLiveError('');
        }
      } catch {
        if (!disposed) {
          setLive(null);
          setLiveError('انقطع تحديث المؤشر. لا تتوفر قراءة لحظية حاليًا.');
        }
      } finally {
        running = false;
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    const resume = () => void refresh();
    document.addEventListener('visibilitychange', resume);
    return () => {
      disposed = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', resume);
    };
  }, []);
  useEffect(() => {
    let disposed = false,
      running = false;
    setDaily(null);
    async function refresh() {
      if (running || document.hidden) return;
      running = true;
      try {
        const value = await request<DailyActivity>(
          '/api/operations/database-activity/daily?day=' + encodeURIComponent(day),
        );
        if (!disposed) {
          setDaily(value);
          setDailyError('');
        }
      } catch {
        if (!disposed) {
          setDaily(null);
          setDailyError('تعذرت قراءة سجل النشاط لهذا اليوم.');
        }
      } finally {
        running = false;
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 60000);
    const resume = () => void refresh();
    document.addEventListener('visibilitychange', resume);
    return () => {
      disposed = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [day]);
  const complete = live?.points.filter((point) => point.at + 2000 <= live.checkedAt) ?? [];
  const last = complete.at(-1);
  const perSecond = (value: number) => (last?.observedMs ? (value * 1000) / last.observedMs : 0);
  const livePoints: ChartPoint[] = complete.map((p) => ({
    x: p.at,
    a: p.observedMs ? (p.reads * 1000) / p.observedMs : null,
    b: p.observedMs ? (p.writes * 1000) / p.observedMs : null,
    label: time(p.at),
  }));
  const observed = daily?.hours.filter((h) => h.observedMs > 0) ?? [];
  const total = observed.reduce(
    (value, h) => ({
      operations: value.operations + h.operations,
      ms: value.ms + h.milliseconds,
      slow: value.slow + h.slow,
      errors: value.errors + h.errors,
      busy: value.busy + h.busy,
    }),
    { operations: 0, ms: 0, slow: 0, errors: 0, busy: 0 },
  );
  const dayPoints: ChartPoint[] =
    daily?.hours.map((h, index) => ({
      x: index,
      a: h.observedMs ? h.reads : null,
      b: h.observedMs ? h.writes : null,
      label: String(index).padStart(2, '0') + ':00',
    })) ?? [];
  const sizePoints: ChartPoint[] =
    daily?.hours.map((h, index) => ({
      x: index,
      a: h.observedMs && h.databaseBytes !== null ? h.databaseBytes / 1048576 : null,
      b: h.observedMs && h.walBytes !== null ? h.walBytes / 1048576 : null,
      label: String(index).padStart(2, '0') + ':00',
    })) ?? [];
  return (
    <section className="activity-section" aria-label="قياس نشاط قاعدة البيانات">
      <section className="dbm-panel activity-live">
        <div className="dbm-section-head">
          <div>
            <h2>نبض قاعدة البيانات</h2>
            <p className="dbm-note">نشاط فعلي خلال آخر خمس دقائق · تحديث كل ثانيتين</p>
          </div>
          <span className={'activity-status ' + (live ? 'activity-connected' : '')}>
            {live ? 'متصل · ' + time(live.checkedAt) : 'لا توجد قراءة حالية'}
          </span>
        </div>
        {liveError && (
          <p role="alert" className="dbm-warning">
            {liveError}
          </p>
        )}
        <div className="activity-summary">
          {[
            ['قراءات / ثانية', last ? number(perSecond(last.reads)) : '—'],
            ['كتابات / ثانية', last ? number(perSecond(last.writes)) : '—'],
            [
              'متوسط التنفيذ',
              last ? number(last.operations ? last.milliseconds / last.operations : 0) + ' ms' : '—',
            ],
            ['أخطاء / انشغال', last ? `${last.errors} / ${last.busy}` : '—'],
          ].map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        {livePoints.length ? (
          <LineChart
            points={livePoints}
            label="معدل القراءات والكتابات الفعلي في الثانية"
            first="قراءات"
            second="كتابات"
            unit="عملية / ثانية"
          />
        ) : (
          <p className="activity-empty">في انتظار عينات القياس الأولى…</p>
        )}
        {live && !live.historyAvailable && (
          <p className="dbm-warning">
            تعذر حفظ أو قراءة السجل اليومي. المؤشر اللحظي مستقل؛ راجع صلاحية الكتابة بجوار قاعدة البيانات.
          </p>
        )}
        {live && live.droppedMinutes > 0 && (
          <p className="dbm-warning">فُقدت بعض ملخصات القياس بعد تعذر الحفظ لفترة طويلة.</p>
        )}
        <p className="dbm-note">
          الخط يعرض محاولات تنفيذ استعلامات الخادم، بما فيها الأعمال الخلفية. المعاملة المالية قد تنفذ عدة
          استعلامات. طلبات هذه الشاشة مستبعدة، والفجوات تعني غياب قياس. زمن التنفيذ يشمل انتظار القاعدة وجلب
          النتيجة، ولا يشمل تجهيز الاستعلام.
        </p>
      </section>
      <section className="dbm-panel">
        <div className="dbm-section-head">
          <h2>الاستهلاك اليومي</h2>
          <label className="activity-date">
            اليوم بتوقيت ليبيا{' '}
            <input
              aria-label="يوم سجل النشاط"
              type="date"
              value={day}
              min={tripoliDay((live?.checkedAt ?? initialTime) - 29 * 86400000)}
              max={tripoliDay(live?.checkedAt ?? initialTime)}
              onChange={(event) => {
                if (event.target.value) setDay(event.target.value);
              }}
            />
          </label>
        </div>
        {dailyError && (
          <p role="alert" className="dbm-warning">
            {dailyError}
          </p>
        )}
        {daily && !daily.available && (
          <p className="dbm-warning">
            السجل اليومي غير متاح بالكامل؛ لا تعتبر القيم المعروضة تقريرًا مكتملًا.
          </p>
        )}
        {observed.length ? (
          <>
            <div className="activity-summary">
              {[
                ['محاولات التنفيذ', number(total.operations)],
                ['متوسط التنفيذ', number(total.operations ? total.ms / total.operations : 0) + ' ms'],
                ['عمليات بطيئة ≥ 50 ms', number(total.slow)],
                ['أخطاء / انشغال', `${total.errors} / ${total.busy}`],
              ].map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            <h3>القراءات والكتابات لكل ساعة</h3>
            <LineChart
              points={dayPoints}
              label="عدد القراءات والكتابات خلال ساعات اليوم"
              first="قراءات"
              second="كتابات"
              unit="عدد العمليات المسجّلة"
            />
            <h3>حجم التخزين خلال اليوم</h3>
            <LineChart
              points={sizePoints}
              label="حجم ملف القاعدة وملف الحركات لكل ساعة"
              first="ملف القاعدة"
              second="ملف WAL"
              unit="MB · آخر عينة متاحة لكل ساعة"
            />
            <details>
              <summary>عرض الأرقام وتغطية القياس لكل ساعة</summary>
              <div className="dbm-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>الساعة</th>
                      <th>دقائق مرصودة</th>
                      <th>قراءات</th>
                      <th>كتابات</th>
                      <th>أخرى / دفعات SQL</th>
                      <th>أخطاء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {daily!.hours.map((h, index) => (
                      <tr key={h.at}>
                        <td>{String(index).padStart(2, '0')}:00</td>
                        <td>{h.observedMs ? number(h.observedMs / 60000) : 'لا يوجد قياس'}</td>
                        <td>{h.observedMs ? h.reads : '—'}</td>
                        <td>{h.observedMs ? h.writes : '—'}</td>
                        <td>{h.observedMs ? h.other : '—'}</td>
                        <td>{h.observedMs ? h.errors : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        ) : (
          <p className="activity-empty">
            {daily
              ? 'لا توجد قياسات مسجّلة لهذا اليوم. يبدأ السجل من وقت تفعيل المراقبة.'
              : 'جارٍ تحميل سجل اليوم…'}
          </p>
        )}
        <p className="dbm-note">
          حفظ ملخص كل دقيقة لمدة 30 يومًا في ملف منفصل. الساعة التي لم يكتمل قياسها تعرض مجموع الفترة المرصودة
          فقط، ولا يُعاد تقدير نشاطها. لا يمثل الرسم نسبة ضغط المعالج أو عدد المعاملات المالية.
        </p>
      </section>
    </section>
  );
}
