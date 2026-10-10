import { useCallback, useEffect, useState } from 'react';
import { Activity, BookOpenText, MonitorSmartphone, RefreshCw, TriangleAlert } from 'lucide-react';
import { api, ApiError, type ManagedSession, type OperationsHealth, type TechnicalEvent } from '../../api.ts';
import { Modal } from '../../components/Modal.tsx';

type Tab = 'health' | 'sessions' | 'errors' | 'guide';
const errorText = (error: unknown) => error instanceof ApiError ? error.message : 'تعذر تحميل مركز التشغيل.';
const dateText = (value: string) => new Intl.DateTimeFormat('ar-LY', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));

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
        <button className={tab === 'health' ? 'active' : ''} onClick={() => setTab('health')}><Activity size={16}/>الحالة</button>
        <button className={tab === 'sessions' ? 'active' : ''} onClick={() => setTab('sessions')}><MonitorSmartphone size={16}/>الجلسات</button>
        <button className={tab === 'errors' ? 'active' : ''} onClick={() => setTab('errors')}><TriangleAlert size={16}/>الأخطاء</button>
        <button className={tab === 'guide' ? 'active' : ''} onClick={() => setTab('guide')}><BookOpenText size={16}/>دليل التشغيل</button>
        <button className="refresh" onClick={() => void load()} aria-label="تحديث"><RefreshCw size={15}/></button>
      </div>
      {notice && <div className="alert error">{notice}</div>}
      {tab === 'health' && health && <div className="operations-health-grid">
        <article><span>حالة قاعدة البيانات</span><strong className={health.integrity === 'ok' ? 'ok' : 'bad'}>{health.integrity === 'ok' ? 'سليمة' : 'تحتاج مراجعة'}</strong></article>
        <article><span>إصدار قاعدة البيانات</span><strong>{health.schemaVersion} {health.schemaVersion === health.expectedSchemaVersion ? '· متوافق' : `· المطلوب ${health.expectedSchemaVersion}`}</strong></article>
        <article><span>الحسابات النشطة</span><strong>{health.activeUsers}</strong></article>
        <article><span>الجلسات النشطة</span><strong>{health.activeSessions}</strong></article>
        <article><span>أخطاء الخادم</span><strong>{health.technicalErrors}</strong></article>
        <article><span>تطابق الأرصدة والسجلات</span><strong className={health.financialMismatches === 0 ? 'ok' : 'bad'}>{health.financialMismatches === 0 ? 'متطابقة' : `${health.financialMismatches} اختلاف`}</strong></article>
        <article><span>وضع التشغيل</span><strong>اتصال إنترنت إلزامي</strong></article>
      </div>}
      {tab === 'sessions' && <div className="operations-sessions-section">
        <div className="operations-section-heading"><strong>الجلسات والأجهزة</strong><span>معرفة الجهاز وعنوان الاتصال وآخر نشاط، وإنهاء أي جلسة أخرى فورًا.</span></div>
        <div className="operations-list">{sessions.map((session) => <article key={session.id}>
          <div className="session-identity"><strong>{session.displayName}</strong><span>الجهاز: {session.device}</span></div>
          <div className="session-address"><span>عنوان الاتصال</span><strong>{session.remoteAddress}</strong></div>
          <div className="session-activity"><span>آخر نشاط</span><strong>{dateText(session.lastSeenAt)}</strong></div>
          <em className={session.active ? 'active' : 'disabled'}>{session.current ? 'هذه الجلسة' : session.active ? 'نشطة' : 'منتهية'}</em>
          <button className="danger subtle" disabled={!session.active || session.current} onClick={() => void revoke(session)}>إنهاء الجلسة</button>
        </article>)}</div>
      </div>}
      {tab === 'errors' && <div className="technical-events">{errors.length === 0 ? <div className="empty-state">لا توجد أخطاء خادم مسجلة.</div> : errors.map((item) => <article key={item.id}><strong>{item.code}</strong><span>{item.requestMethod} {item.requestPath}</span><small>{item.message} · {dateText(item.createdAt)} · {item.correlationId}</small></article>)}</div>}
      {tab === 'guide' && <div className="operations-guide">
        <article><strong>الحسابات والصلاحيات</strong><p>أنشئ الموظف بكلمة مؤقتة، فعّل الأقسام المطلوبة فقط، ثم يغيّر الموظف كلمة المرور عند أول دخول.</p></article>
        <article><strong>المزامنة والتعارض</strong><p>عند ظهور تعارض إصدار، حدّث السجل ثم أعد التعديل؛ لا تُكتب بيانات جلسة فوق جلسة أخرى.</p></article>
        <article><strong>الانتقال إلى VPS</strong><p>بيانات الاتصال والأسرار خارج الكود، لذلك ينتقل البناء نفسه دون إعادة كتابة الأقسام.</p></article>
      </div>}
    </div>;
  return embedded
    ? <div className="settings-operations-page">{content}</div>
    : <Modal title="مركز التشغيل والأمان" onClose={onClose}>{content}</Modal>;
}
