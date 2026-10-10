import { useCallback, useEffect, useState } from 'react';
import { Archive, DatabaseBackup, FileCheck2, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
import { api, ApiError, type OperationsHealth } from '../../api.ts';

const errorText = (error: unknown) => error instanceof ApiError ? error.message : 'تعذر تحميل حالة النسخ الاحتياطي.';

export function BackupCenterManager() {
  const [health, setHealth] = useState<OperationsHealth | null>(null);
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    setNotice('');
    try { setHealth(await api.operationsHealth()); }
    catch (error) { setNotice(errorText(error)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return <div className="settings-backup-page">
    {notice && <div className="alert error">{notice}</div>}
    <div className="backup-status-grid">
      <article><span>حالة قاعدة البيانات</span><strong className={health?.integrity === 'ok' ? 'ok' : ''}>{health ? (health.integrity === 'ok' ? 'سليمة' : 'تحتاج مراجعة') : 'جارٍ الفحص'}</strong></article>
      <article><span>إصدار النسخة</span><strong>{health ? `المخطط ${health.schemaVersion}` : '—'}</strong><small>{health && health.schemaVersion === health.expectedSchemaVersion ? 'متوافق مع التطبيق' : ''}</small></article>
      <article><span>سياسة التشغيل الحالية</span><strong>يدوية حتى التشغيل الفعلي</strong></article>
      <article><span>اختبار الاستعادة</span><strong className={health?.restoreDrillAvailable ? 'ok' : ''}>{health?.restoreDrillAvailable ? 'جاهز' : 'غير متاح'}</strong></article>
    </div>

    <div className="backup-policy-note">
      <ShieldCheck size={22} />
      <div><strong>لم يُفعّل النسخ التلقائي للبيانات التجريبية</strong><span>المركز والبرامج جاهزة، ويُفعّل الجدول الفعلي فقط عند بدء إدخال البيانات الحقيقية بقرار الإدارة.</span></div>
    </div>

    <div className="backup-details-grid">
      <section className="backup-panel">
        <h3>محتويات النسخة الكاملة</h3>
        <ul className="backup-checklist">
          <li><DatabaseBackup size={17}/><span>قاعدة البيانات المالية وكروت الأقسام وسجلاتها الدائمة</span></li>
          <li><Archive size={17}/><span>الحسابات والصلاحيات وإعدادات المؤسسة وسجل التدقيق</span></li>
          <li><FileCheck2 size={17}/><span>ملف تعريف للنسخة يتضمن الحجم والإصدار وتاريخ الإنشاء</span></li>
          <li><ShieldCheck size={17}/><span>بصمة SHA-256 تكشف أي تغيير أو تلف قبل الاستعادة</span></li>
        </ul>
      </section>
      <section className="backup-panel">
        <h3>مسار الاستعادة الآمن</h3>
        <ol className="backup-workflow">
          <li><b>1</b><span>إنشاء نسخة متسقة دون إيقاف قاعدة البيانات</span></li>
          <li><b>2</b><span>فحص سلامة SQLite والعلاقات وإصدار المخطط والبصمة</span></li>
          <li><b>3</b><span>تشغيل اختبار استعادة على نسخة منفصلة قبل لمس البيانات الحية</span></li>
          <li><b>4</b><span>إنشاء نسخة إنقاذ ثم الاستعادة والتحقق من الخادم وHTTPS</span></li>
        </ol>
      </section>
    </div>

    <div className="backup-details-grid">
      <section className="backup-panel">
        <h3>الخطة الجاهزة عند التفعيل</h3>
        <ul className="backup-checklist">
          <li><Archive size={17}/><span>نسخة يومية في 23:30 كإعداد افتراضي قابل للتغيير</span></li>
          <li><RotateCcw size={17}/><span>الاحتفاظ بآخر 30 نسخة كإعداد افتراضي، بحد من 1 إلى 365</span></li>
        </ul>
      </section>
      <section className="backup-panel">
        <h3>قواعد الحماية</h3>
        <ul className="backup-checklist">
          <li><ShieldCheck size={17}/><span>لا تُستعاد نسخة ناقصة أو بلا ملف تعريف أو ببصمة غير مطابقة</span></li>
          <li><ShieldCheck size={17}/><span>لا تُستخدم قاعدة البيانات الحية كمصدر استعادة لنفسها</span></li>
        </ul>
      </section>
    </div>

    <footer className="backup-footer">
      <span>{health ? `آخر فحص لحالة الخادم: ${new Intl.DateTimeFormat('ar-LY', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(health.checkedAt))}` : 'جارٍ تحميل الحالة'}</span>
      <button className="secondary compact" onClick={() => void load()}><RefreshCw size={15}/>تحديث الحالة</button>
    </footer>
  </div>;
}
