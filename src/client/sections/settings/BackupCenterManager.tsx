import { useCallback, useEffect, useState } from 'react';
import { Archive, DatabaseBackup, FileCheck2, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
import { api, ApiError, type OperationsHealth } from '../../api.ts';
import { request } from '../../apiTransport.ts';

const errorText = (error: unknown) => error instanceof ApiError ? error.message : 'تعذر تحميل حالة النسخ الاحتياطي.';

export function BackupCenterManager() {
  const [health, setHealth] = useState<OperationsHealth | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [backupNotice, setBackupNotice] = useState('');
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreManifest, setRestoreManifest] = useState<File | null>(null);
  const [restoreConfirmation, setRestoreConfirmation] = useState('');
  const [backupPassword, setBackupPassword] = useState('');
  const [backupPasswordConfirm, setBackupPasswordConfirm] = useState('');
  const [restorePassword, setRestorePassword] = useState('');
  const downloadEmergency = async () => {
    setBusy(true); setBackupNotice('');
    try {
      const result = await request<{ createdAt: string }>('/api/operations/backup/emergency', { method: 'POST', body: JSON.stringify({ password: backupPassword }) });
      const objectUrl = URL.createObjectURL(new Blob([JSON.stringify(result)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = objectUrl; link.download = `abdo-emergency-${result.createdAt.replace(/[:.]/g, '-')}.abdobackup`;
      link.click(); setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
      setBackupPassword(''); setBackupPasswordConfirm('');
      setBackupNotice('تم تنزيل نسخة مشفّرة. احتفظ بكلمة التشفير في مكان منفصل؛ لا يمكن استعادتها إذا فُقدت.');
    } catch (error) { setBackupNotice(errorText(error)); }
    finally { setBusy(false); }
  };
  const restore = async () => {
    if (!restoreFile || restoreConfirmation !== 'استعادة') return;
    if (!window.confirm('ستستبدل الاستعادة جميع بيانات النظام بالنسخة المختارة. ستُحفظ نسخة إنقاذ، ثم يعاد تشغيل الخادم وتسجيل الدخول. هل تؤكد؟')) return;
    setBusy(true); setBackupNotice('');
    try {
      if (restoreFile.size > 68 * 1024 * 1024) throw new Error('حجم ملف الاستعادة يتجاوز 68 ميجابايت.');
      let backup: unknown;
      if (restoreFile.name.endsWith('.sqlite')) {
        if (!restoreManifest) throw new Error('اختر ملف SQLite وملف التعريف JSON الخاص به معًا.');
        if (restoreFile.size > 48 * 1024 * 1024 || restoreManifest.size > 16384) throw new Error('حجم النسخة أو ملف التعريف يتجاوز الحد المسموح.');
        const manifest = JSON.parse(await restoreManifest.text());
        if (manifest.manifestVersion !== 1 || manifest.file !== restoreFile.name) throw new Error('ملف التعريف لا يطابق النسخة المختارة.');
        const bytes = new Uint8Array(await restoreFile.arrayBuffer());
        let binary = '';
        for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
        backup = { format: 'abdo-erp-backup', version: 1, size: manifest.fileSizeBytes, sha256: manifest.sha256, database: btoa(binary) };
      } else { backup = JSON.parse(await restoreFile.text()); }
      const result = await request<{ message: string }>('/api/operations/backup/restore', { method: 'POST', body: JSON.stringify({ backup, confirmation: restoreConfirmation, password: restorePassword }) });
      setBackupNotice(result.message); setRestoreFile(null); setRestoreConfirmation(''); setRestorePassword('');
    } catch (error) { setBackupNotice(error instanceof ApiError ? error.message : error instanceof SyntaxError ? 'الملف ليس نسخة احتياطية صالحة.' : error instanceof Error ? error.message : 'تعذر الاستعادة.'); }
    finally { setBusy(false); }
  };
  const load = useCallback(async () => {
    setNotice('');
    try { setHealth(await api.operationsHealth()); }
    catch (error) { setNotice(errorText(error)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const schedule = health?.backupSchedule;
  const backupTime = (value: string) => new Intl.DateTimeFormat('ar-LY', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Africa/Tripoli' }).format(new Date(value));

  return <div className="settings-backup-page">
    {notice && <div className="alert error">{notice}</div>}
    {backupNotice && <div role="status" className="backup-policy-note">{backupNotice}</div>}
    <div className="backup-details-grid backup-actions-grid">
      <section className="backup-panel">
        <h3>نسخة كاملة طارئة</h3>
        <p>تنزيل قاعدة البيانات كاملة، بما فيها الحسابات والصلاحيات والسجلات والإعدادات، مع بصمة للتحقق. لا يتوقف النظام أثناء إنشاء النسخة.</p>
        <label>كلمة تشفير النسخة (12 حرفًا على الأقل)<input type="password" minLength={12} maxLength={256} value={backupPassword} onChange={event => setBackupPassword(event.target.value)} autoComplete="new-password" disabled={busy} /></label>
        <label>تأكيد كلمة التشفير<input type="password" maxLength={256} value={backupPasswordConfirm} onChange={event => setBackupPasswordConfirm(event.target.value)} autoComplete="new-password" disabled={busy} /></label>
        <small>احفظ الكلمة منفصلة عن الملف. فقدانها يمنع استعادة النسخة.</small>
        <button className="secondary" disabled={busy || backupPassword.length < 12 || backupPassword !== backupPasswordConfirm} onClick={() => void downloadEmergency()}><DatabaseBackup size={17}/> {busy ? 'جارٍ التنفيذ…' : 'تنزيل نسخة طارئة مشفّرة'}</button>
      </section>
      <section className="backup-panel">
        <h3>استعادة نسخة احتياطية</h3>
        <p role="status">حالة الاستعادة: {{ idle: 'لا توجد استعادة سابقة', queued: 'بانتظار التنفيذ خلال دقيقة', running: 'قيد التنفيذ', succeeded: 'اكتملت بنجاح', failed: 'فشلت؛ راجع سجل الاستعادة على السيرفر' }[health?.restoreStatus?.state ?? ''] ?? 'غير متحقق'}</p>
        <p>اختر النسخة الطارئة بصيغة abdobackup، أو اختر ملف النسخة اليومية SQLite وملف تعريفها JSON معًا. الاستعادة تستبدل البيانات الحالية بالكامل وتتطلب حساب المالك، مع حفظ نسخة إنقاذ قبل الاستبدال.</p>
        <label>ملفات النسخة <input type="file" multiple accept=".abdobackup,.sqlite,.json" disabled={busy} onChange={event => { const files = Array.from(event.target.files ?? []); setRestoreFile(files.find(file => file.name.endsWith('.abdobackup') || file.name.endsWith('.sqlite')) ?? null); setRestoreManifest(files.find(file => file.name.endsWith('.json')) ?? null); }}/></label>
        <label>اكتب «استعادة» للتأكيد <input value={restoreConfirmation} disabled={busy} onChange={event => setRestoreConfirmation(event.target.value)} autoComplete="off" /></label>
        <label>كلمة فك التشفير (للنسخ المشفّرة)<input type="password" maxLength={256} value={restorePassword} disabled={busy} onChange={event => setRestorePassword(event.target.value)} autoComplete="off" /></label>
        <small>للنسخ التلقائية من هذا الخادم، اترك كلمة التشفير فارغة لاستخدام مفتاح الخادم. عند الاستعادة على جهاز جديد يلزم ملف المفتاح المحفوظ منفصلًا.</small>
        <button className="secondary" disabled={busy || !restoreFile || restoreConfirmation !== 'استعادة'} onClick={() => void restore()}><RotateCcw size={17}/>فحص النسخة واستعادتها</button>
        <small>الحد الأقصى لقاعدة البيانات: 48 ميجابايت. لا تشمل النسخة ملفات البرنامج أو رمز Cloudflare. ستحتاج لتسجيل الدخول بعد الاستعادة.</small>
      </section>
    </div>
    <div className="backup-status-grid">
      <article><span>حالة قاعدة البيانات</span><strong className={health?.integrity === 'ok' ? 'ok' : ''}>{health ? (health.integrity === 'ok' ? 'سليمة' : 'تحتاج مراجعة') : 'جارٍ الفحص'}</strong></article>
      <article><span>إصدار النسخة</span><strong>{health ? `المخطط ${health.schemaVersion}` : '—'}</strong><small>{health && health.schemaVersion === health.expectedSchemaVersion ? 'متوافق مع التطبيق' : ''}</small></article>
      <article><span>النسخ التلقائي على الخادم</span><strong>{schedule ? (schedule.lastError ? 'فشل آخر تنفيذ' : schedule.lastSuccess ? 'آخر نسخة ناجحة' : 'مجدول') : health ? 'غير متحقق' : 'جارٍ الفحص'}</strong><small>{schedule?.lastSuccess ? backupTime(schedule.lastSuccess) : 'لم تُسجل نسخة ناجحة بعد'}</small></article>
      <article><span>آخر اختبار استعادة</span><strong>{health ? 'لا توجد نتيجة موثقة هنا' : 'جارٍ الفحص'}</strong></article>
    </div>

    <div className="backup-policy-note">
      <ShieldCheck size={22} />
      <div><strong>نسخ محلية تلقائية مع فحص سلامة كل نسخة</strong><span>تعرض الصفحة إعداد الجدول ونتيجة آخر تنفيذ مسجلة على الخادم. اختبار الاستعادة إجراء منفصل، ولا يُستنتج نجاحه من سلامة النسخة.</span></div>
    </div>

    <details className="backup-more">
      <summary>محتويات النسخة وخطوات الاستعادة</summary>
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

    </details>
    <div className="backup-details-grid">
      <section className="backup-panel">
        <h3>جدول النسخ المحلي — بتوقيت ليبيا</h3>
        <ul className="backup-checklist">
          <li><Archive size={17}/><span>{schedule ? `أوقات النسخ: ${schedule.hours.map(hour => `${String(hour).padStart(2, '0')}:00`).join('، ')}` : 'لم يتم العثور على إعداد جدول النسخ'}</span></li>
          <li><Archive size={17}/><span>مجلد الحفظ الثابت على السيرفر: <b dir="ltr" style={{ overflowWrap: 'anywhere' }}>{schedule?.output ?? '—'}</b></span></li>
          <li><RotateCcw size={17}/><span>الاحتفاظ بآخر {schedule?.retentionCount ?? '—'} نسخة</span></li>
          {schedule?.lastFile && <li><FileCheck2 size={17}/><span>آخر ملف: <b dir="ltr" style={{ overflowWrap: 'anywhere' }}>{schedule.lastFile}</b></span></li>}
          {schedule?.lastError && <li><span className="alert error">{schedule.lastError}</span></li>}
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
