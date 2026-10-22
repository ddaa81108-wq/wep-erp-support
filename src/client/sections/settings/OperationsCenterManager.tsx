import { uiText, displayLocale } from '../../i18n/language.ts';
import { useCallback, useEffect, useState } from 'react';
import { Activity, BookOpenText, MonitorSmartphone, RefreshCw, TriangleAlert } from 'lucide-react';
import { api, ApiError, type ManagedSession, type OperationsHealth, type TechnicalEvent } from '../../api.ts';
import { Modal } from '../../components/Modal.tsx';

type Tab = 'health' | 'sessions' | 'errors' | 'guide';
const errorText = (error: unknown) => error instanceof ApiError ? error.message : uiText("تعذر تحميل مركز التشغيل.");
const dateText = (value: string) => new Intl.DateTimeFormat(displayLocale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));

export function OperationsCenterManager({ onClose, embedded = false }: { onClose: () => void; embedded?: boolean }) {
  const [tab, setTab] = useState<Tab>('health');
  const [health, setHealth] = useState<OperationsHealth | null>(null);
  const [sessions, setSessions] = useState<ManagedSession[]>([]);
  const [errors, setErrors] = useState<TechnicalEvent[]>([]);
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    setNotice('');
    try {
      const [nextHealth, nextSessions, nextErrors] = await Promise.all([
        api.operationsHealth(), api.managedSessions(), api.technicalEvents(),
      ]);
      setHealth(nextHealth); setSessions(nextSessions.items); setErrors(nextErrors.items);
    } catch (error) { setNotice(errorText(error)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function revoke(session: ManagedSession) {
    if (session.current) return;
    try { await api.revokeManagedSession(session.id); await load(); }
    catch (error) { setNotice(errorText(error)); }
  }

  const content = <div className="operations-center">
      <div className="operations-tabs">
        <button className={tab === 'health' ? 'active' : ''} onClick={() => setTab('health')}><Activity size={16}/>{uiText("الحالة")}</button>
        <button className={tab === 'sessions' ? 'active' : ''} onClick={() => setTab('sessions')}><MonitorSmartphone size={16}/>{uiText("الجلسات")}</button>
        <button className={tab === 'errors' ? 'active' : ''} onClick={() => setTab('errors')}><TriangleAlert size={16}/>{uiText("الأخطاء")}</button>
        <button className={tab === 'guide' ? 'active' : ''} onClick={() => setTab('guide')}><BookOpenText size={16}/>{uiText("دليل التشغيل")}</button>
        <button className="refresh" onClick={() => void load()} aria-label={uiText("تحديث")}><RefreshCw size={15}/></button>
      </div>
      {notice && <div className="alert error">{notice}</div>}
      {tab === 'health' && health && <div className="operations-health-grid">
        <article><span>{uiText("حالة قاعدة البيانات")}</span><strong className={health.integrity === 'ok' ? 'ok' : 'bad'}>{health.integrity === 'ok' ? uiText("سليمة") : uiText("تحتاج مراجعة")}</strong></article>
        <article><span>{uiText("إصدار قاعدة البيانات")}</span><strong>{health.schemaVersion} {health.schemaVersion === health.expectedSchemaVersion ? uiText("· متوافق") : uiText("· المطلوب {0}", [health.expectedSchemaVersion])}</strong></article>
        <article><span>{uiText("الحسابات النشطة")}</span><strong>{health.activeUsers}</strong></article>
        <article><span>{uiText("الجلسات النشطة")}</span><strong>{health.activeSessions}</strong></article>
        <article><span>{uiText("أخطاء الخادم")}</span><strong>{health.technicalErrors}</strong></article>
        <article><span>{uiText("تطابق الأرصدة والسجلات")}</span><strong className={health.financialMismatches === 0 ? 'ok' : 'bad'}>{health.financialMismatches === 0 ? uiText("متطابقة") : uiText("{0} اختلاف", [health.financialMismatches])}</strong></article>
        <article><span>{uiText("وضع التشغيل")}</span><strong>{health.onlineOnly ? uiText("اتصال إنترنت إلزامي") : uiText("التشغيل داخل الشبكة متاح دون إنترنت")}</strong></article>
      </div>}
      {tab === 'sessions' && <div className="operations-sessions-section">
        <div className="operations-section-heading"><strong>{uiText("الجلسات والأجهزة")}</strong><span>{uiText("معرفة الجهاز وعنوان الاتصال وآخر نشاط، وإنهاء أي جلسة أخرى فورًا.")}</span></div>
        <div className="operations-list">{sessions.map((session) => <article key={session.id}>
          <div className="session-identity"><strong>{session.displayName}</strong><span>{uiText("الجهاز: ")}{session.device}</span></div>
          <div className="session-address"><span>{uiText("عنوان الاتصال")}</span><strong>{session.remoteAddress}</strong></div>
          <div className="session-activity"><span>{uiText("آخر نشاط")}</span><strong>{dateText(session.lastSeenAt)}</strong></div>
          <em className={session.active ? 'active' : 'disabled'}>{session.current ? uiText("هذه الجلسة") : session.active ? uiText("نشطة") : uiText("منتهية")}</em>
          <button className="danger subtle" disabled={!session.active || session.current} onClick={() => void revoke(session)}>{uiText("إنهاء الجلسة")}</button>
        </article>)}</div>
      </div>}
      {tab === 'errors' && <div className="technical-events">{errors.length === 0 ? <div className="empty-state">{uiText("لا توجد أخطاء خادم مسجلة.")}</div> : errors.map((item) => <article key={item.id}><strong>{item.code}</strong><span>{item.requestMethod} {item.requestPath}</span><small>{item.message} · {dateText(item.createdAt)} · {item.correlationId}</small></article>)}</div>}
      {tab === 'guide' && <div className="operations-guide">
        <article><strong>{uiText("الحسابات والصلاحيات")}</strong><p>{uiText("أنشئ الموظف بكلمة مؤقتة، فعّل الأقسام المطلوبة فقط، ثم يغيّر الموظف كلمة المرور عند أول دخول.")}</p></article>
        <article><strong>{uiText("المزامنة والتعارض")}</strong><p>{uiText("عند ظهور تعارض إصدار، حدّث السجل ثم أعد التعديل؛ لا تُكتب بيانات جلسة فوق جلسة أخرى.")}</p></article>
        <article><strong>{uiText("الانتقال إلى VPS")}</strong><p>{uiText("بيانات الاتصال والأسرار خارج الكود، لذلك ينتقل البناء نفسه دون إعادة كتابة الأقسام.")}</p></article>
      </div>}
    </div>;
  return embedded
    ? <div className="settings-operations-page">{content}</div>
    : <Modal title={uiText("مركز التشغيل والأمان")} onClose={onClose}>{content}</Modal>;
}
