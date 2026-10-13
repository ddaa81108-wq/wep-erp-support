import { DatabaseActivity } from './DatabaseActivity.tsx';
import { useEffect, useState } from 'react';
import { api, type User } from '../api.ts';
import { ApiError, request } from '../apiTransport.ts';
import { ThemeToggle, type Theme } from '../components/ThemeToggle.tsx';
import type { databaseMonitor } from '../../server/domain/databaseMonitor.ts';
import './database-monitor.css';
type Snapshot = Awaited<ReturnType<typeof databaseMonitor>>;
const bytes = (value: number | null) => {
  if (value === null) return 'غير متاح';
  const index = value === 0 ? 0 : Math.min(3, Math.floor(Math.log(value) / Math.log(1024)));
  return (
    new Intl.NumberFormat('ar-LY', { maximumFractionDigits: 2 }).format(value / 1024 ** index) +
    ' ' +
    ['B', 'KB', 'MB', 'GB'][index]
  );
};
const date = (value: string | null) =>
  value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat('ar-LY', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Africa/Tripoli',
      }).format(new Date(value))
    : 'غير مسجّل';
export function DatabaseMonitor({
  user,
  theme,
  onThemeToggle,
  onLogout,
}: {
  user: User;
  theme: Theme;
  onThemeToggle: () => void;
  onLogout: () => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!user.isOwner || user.role !== 'admin') return;
    let disposed = false;
    let active = false;
    async function refresh() {
      if (active) return;
      active = true;
      setBusy(true);
      try {
        const next = await request<Snapshot>('/api/operations/database-monitor');
        if (!disposed) {
          setSnapshot(next);
          setError('');
        }
      } catch (cause) {
        if (!disposed) {
          setError(
            cause instanceof ApiError && cause.status === 403
              ? 'ليس لديك صلاحية متابعة قاعدة البيانات.'
              : 'تعذر تحديث البيانات. تحقق من الاتصال وسجّل الدخول من جديد إذا انتهت الجلسة.',
          );
          setSnapshot(null);
        }
      } finally {
        active = false;
        if (!disposed) setBusy(false);
      }
    }
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 60000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [user.isOwner, user.role, revision]);
  async function logout() {
    try {
      await api.logout();
      onLogout();
    } catch {
      setError('تعذر تسجيل الخروج. حاول مرة أخرى.');
    }
  }
  return (
    <main className="database-monitor" dir="rtl">
      <header className="dbm-header">
        <div>
          <span className="dbm-eyebrow">VIB Abdo Company · متابعة التشغيل</span>
          <h1>قاعدة البيانات والنسخ الاحتياطية</h1>
          <p>صفحة مستقلة للمتابعة · توقيت ليبيا</p>
        </div>
        <nav aria-label="أدوات الصفحة">
          <ThemeToggle theme={theme} onToggle={onThemeToggle} />
          <a href="/erp">فتح المنظومة</a>
          <button onClick={() => void logout()}>تسجيل الخروج</button>
        </nav>
      </header>
      {!user.isOwner || user.role !== 'admin' ? (
        <section className="dbm-panel" role="alert">
          هذه الصفحة متاحة لمالك المنظومة فقط.
        </section>
      ) : (
        <>
          <div className="dbm-toolbar">
            <span>
              {snapshot ? 'آخر تحديث: ' + date(snapshot.checkedAt) : 'جارٍ قراءة حالة الخادم'} · تحديث تلقائي
              كل دقيقة أثناء فتح الصفحة
            </span>
            <button disabled={busy} onClick={() => setRevision((value) => value + 1)}>
              {busy ? 'جارٍ التحديث…' : 'تحديث الآن'}
            </button>
          </div>
          {error && (
            <p role="alert" className="dbm-warning">
              {error}
            </p>
          )}
          <DatabaseActivity />
          {snapshot && (
            <>
              <section className="dbm-cards" aria-label="أحجام التخزين">
                {[
                  ['ملف قاعدة البيانات', bytes(snapshot.database.sizeBytes)],
                  ['ملف الحركات WAL', bytes(snapshot.database.walBytes)],
                  [
                    'النسخ الموجودة',
                    snapshot.backups.folderState === 'readable' ? String(snapshot.backups.count) : 'غير متاح',
                  ],
                  [
                    'حجم النسخ',
                    snapshot.backups.folderState === 'readable'
                      ? bytes(snapshot.backups.totalBytes)
                      : 'غير متاح',
                  ],
                  ['المتاح على قرص القاعدة', bytes(snapshot.database.diskFreeBytes)],
                ].map(([label, value]) => (
                  <article key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </article>
                ))}
              </section>
              <div className="dbm-columns">
                <section className="dbm-panel">
                  <h2>قاعدة البيانات الحالية</h2>
                  <dl>
                    <dt>الملف الفعلي</dt>
                    <dd>{snapshot.database.name}</dd>
                    <dt>مسار الخادم</dt>
                    <dd className="dbm-path">{snapshot.database.path ?? 'ذاكرة مؤقتة'}</dd>
                    <dt>إصدار مخطط البيانات</dt>
                    <dd>{snapshot.database.schemaVersion}</dd>
                    <dt>ملف المشاركة SHM</dt>
                    <dd>{bytes(snapshot.database.shmBytes)}</dd>
                    <dt>مساحة الصفحات المنطقية</dt>
                    <dd>{bytes(snapshot.database.allocatedBytes)}</dd>
                    <dt>مساحة قابلة لإعادة الاستخدام داخل القاعدة</dt>
                    <dd>{bytes(snapshot.database.reusableBytes)}</dd>
                  </dl>
                  <p className="dbm-note">
                    ملف WAL قد يحتوي أحدث الحركات قبل دمجها في الملف الرئيسي. الأحجام للمتابعة ولا تعني فحص
                    سلامة البيانات.
                  </p>
                </section>
                <section className="dbm-panel">
                  <h2>متابعة النسخ المجدول</h2>
                  {snapshot.schedule ? (
                    <>
                      <p className={snapshot.schedule.hasError ? 'dbm-warning' : 'dbm-note'}>
                        {snapshot.schedule.hasError
                          ? 'آخر تشغيل سجّل خطأ؛ يلزم مراجعة سجل النسخ على الخادم.'
                          : 'لا يوجد خطأ في سجل الجدولة المقروء.'}
                      </p>
                      <dl>
                        <dt>مواعيد النسخ المسجّلة</dt>
                        <dd>
                          {snapshot.schedule.hours
                            .map((hour) => String(hour).padStart(2, '0') + ':00')
                            .join('، ')}
                        </dd>
                        <dt>عدد النسخ المحتفظ بها حسب الإعداد</dt>
                        <dd>{snapshot.schedule.retentionCount}</dd>
                        <dt>آخر نجاح مسجّل</dt>
                        <dd>{date(snapshot.schedule.lastSuccess)}</dd>
                      </dl>
                      {!snapshot.schedule.matchesFolder && (
                        <p className="dbm-warning">مجلد العرض مختلف عن مجلد الجدولة.</p>
                      )}
                    </>
                  ) : (
                    <p className="dbm-warning">
                      لا تتوفر معلومات جدول نسخ تخص هذه القاعدة. وجود ملفات نسخ وحده لا يؤكد تشغيل النسخ
                      التلقائي.
                    </p>
                  )}
                  <p className="dbm-note">
                    تُعرض إعدادات الجدولة المسجّلة؛ لا تفحص الصفحة حالة مهمة Windows مباشرة.
                  </p>
                </section>
              </div>
              <section className="dbm-panel">
                <div className="dbm-section-head">
                  <h2>النسخ الاحتياطية الموجودة</h2>
                  <span>الأحدث تعديلًا أولًا</span>
                </div>
                <p className="dbm-path">{snapshot.backups.folder}</p>
                {snapshot.backups.folderState !== 'readable' ? (
                  <p className="dbm-warning">
                    {snapshot.backups.folderState === 'missing'
                      ? 'مجلد النسخ غير موجود.'
                      : 'تعذر قراءة مجلد النسخ؛ تحقق من صلاحية خدمة المنظومة.'}
                  </p>
                ) : !snapshot.backups.count ? (
                  <p className="dbm-note">لا توجد ملفات نسخ SQLite في هذا المجلد.</p>
                ) : (
                  <div className="dbm-table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>اسم النسخة</th>
                          <th>آخر تعديل للملف</th>
                          <th>الحجم</th>
                          <th>تقرير الإنشاء</th>
                        </tr>
                      </thead>
                      <tbody>
                        {snapshot.backups.items.map((item) => (
                          <tr key={item.name}>
                            <td className="dbm-file">{item.name}</td>
                            <td>{date(item.modifiedAt)}</td>
                            <td>{bytes(item.sizeBytes)}</td>
                            <td>
                              <span
                                className={'dbm-badge ' + (item.report === 'recorded' ? 'dbm-recorded' : '')}
                              >
                                {item.report === 'recorded'
                                  ? 'فحص نجاح مسجّل عند الإنشاء'
                                  : item.report === 'invalid'
                                    ? 'التقرير غير صالح أو غير مطابق'
                                    : 'لا يوجد تقرير إنشاء'}
                              </span>
                              {item.recordedAt && <small>{date(item.recordedAt)}</small>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {snapshot.backups.count > snapshot.backups.limit && (
                  <p>تُعرض أحدث {snapshot.backups.limit} نسخة؛ العدد والحجم يشملان كل الملفات المقروءة.</p>
                )}
                {snapshot.backups.unreadableFiles > 0 && (
                  <p className="dbm-warning">
                    تعذرت قراءة {snapshot.backups.unreadableFiles} ملفات؛ الإجمالي لا يشملها.
                  </p>
                )}
                <p className="dbm-note">
                  التقرير سجلّ الفحص وقت إنشاء النسخة، وليس فحصًا جديدًا أو ضمانًا لإمكانية الاستعادة. الملفات
                  المعروضة من المجلد المحدد؛ لا تُفحص محتوياتها أو مطابقتها لهذه القاعدة في هذه الصفحة.
                </p>
              </section>
            </>
          )}
        </>
      )}
    </main>
  );
}
