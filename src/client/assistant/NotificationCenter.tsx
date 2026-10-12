import { Bell, BellRing, CheckCheck, MessageSquareText, Volume2, VolumeX, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { User } from '../api.ts';
import { isMainSection, type MainSection } from '../../shared/sections.ts';
import { useNotifications } from './useNotifications.ts';
import { notificationSentence } from './notificationModel.ts';

const time = new Intl.DateTimeFormat('ar-LY', { dateStyle: 'short', timeStyle: 'short' });

export function NotificationCenter({
  user,
  onOpenSection,
}: {
  user: User;
  onOpenSection: (section: MainSection) => void;
}) {
  const enabled = user.role === 'admin' || user.permissions?.includes('collections.read') === true;
  const [open, setOpen] = useState(false);
  const notifications = useNotifications(enabled);
  const insight = useMemo(() => {
    const unread = notifications.items.filter((item) => !item.readAt);
    if (!unread.length) return 'لا توجد حركات جديدة تحتاج مراجعتك.';
    const actors = new Map<string, number>();
    unread.forEach((item) => actors.set(item.actorName, (actors.get(item.actorName) ?? 0) + 1));
    const busiest = [...actors].sort((a, b) => b[1] - a[1])[0];
    return `${unread.length} حركة غير مقروءة، وأكثرها بواسطة ${busiest[0]} (${busiest[1]}).`;
  }, [notifications.items]);

  if (!enabled) return null;
  return (
    <div className="notification-center">
      {notifications.announcement && (
        <button
          className="notification-toast"
          aria-label="إشعار جديد"
          onClick={() => {
            void notifications.markRead(notifications.announcement!.id);
            notifications.clearAnnouncement();
            setOpen(true);
          }}
        >
          <BellRing size={18} />
          <span>{notificationSentence(notifications.announcement)}</span>
          <X size={15} onClick={(event) => { event.stopPropagation(); notifications.clearAnnouncement(); }} />
        </button>
      )}
      <button
        className="utility-icon-button"
        aria-label="الإشعارات"
        title="الإشعارات"
        onClick={() => setOpen((value) => !value)}
      >
        {notifications.unreadCount ? <BellRing size={19} /> : <Bell size={19} />}
        {notifications.unreadCount > 0 && <b>{Math.min(99, notifications.unreadCount)}</b>}
      </button>
      {open && (
        <aside className="notification-panel" aria-label={user.role === 'admin' ? 'مركز مراجعة الإدارة' : 'مركز الإشعارات'}>
          <header>
            <div><strong>{user.role === 'admin' ? 'مركز مراجعة الإدارة' : 'الإشعارات'}</strong><small>{notifications.unreadCount} حركة تحتاج قراءة</small></div>
            <button aria-label="إغلاق" onClick={() => setOpen(false)}><X size={17} /></button>
          </header>
          <div className="notification-insight">
            <strong>ملخص آلي للمراجعة</strong>
            <span>{insight}</span>
          </div>
          <div className="notification-actions">
            <button disabled={!notifications.unreadCount} onClick={() => void notifications.markAllRead()}>
              <CheckCheck size={15} /> تعليم الكل كمقروء
            </button>
            <button
              className="notification-toggle"
              disabled={!notifications.preferencesReady || notifications.preferencesSaving}
              aria-busy={notifications.preferencesSaving}
              aria-pressed={notifications.preferences.soundEnabled}
              title={notifications.preferences.soundEnabled ? 'إيقاف الصوت' : 'تشغيل الصوت'}
              onClick={() => void notifications.updatePreferences({
                ...notifications.preferences,
                soundEnabled: !notifications.preferences.soundEnabled,
              })}
            >
              {notifications.preferences.soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
              <span>الصوت<strong>{!notifications.preferencesReady ? 'جارٍ التحميل…' : notifications.preferences.soundEnabled ? 'مفعّل' : 'متوقف'}</strong></span>
            </button>
            <button
              className="notification-toggle"
              disabled={!notifications.preferencesReady || notifications.preferencesSaving}
              aria-busy={notifications.preferencesSaving}
              aria-pressed={notifications.preferences.speechEnabled}
              title={notifications.preferences.speechEnabled ? 'إيقاف النطق' : 'تشغيل النطق'}
              onClick={() => void notifications.updatePreferences({
                ...notifications.preferences,
                speechEnabled: !notifications.preferences.speechEnabled,
              })}
            >
              <MessageSquareText size={15} />
              <span>النطق<strong>{!notifications.preferencesReady ? 'جارٍ التحميل…' : notifications.preferences.speechEnabled ? 'مفعّل' : 'متوقف'}</strong></span>
            </button>
          </div>
          {notifications.preferencesSaving && <p className="notification-preference-status" role="status">جارٍ حفظ إعدادات التنبيه…</p>}
          {notifications.preferencesError && <p className="notification-error" role="alert">{notifications.preferencesError}</p>}
          {notifications.error && <p className="notification-error">{notifications.error}</p>}
          <div className="notification-list">
            {notifications.loading && <p>جارٍ تحميل الإشعارات…</p>}
            {!notifications.loading && notifications.items.length === 0 && <p>لا توجد إشعارات حتى الآن.</p>}
            {notifications.items.map((item) => (
              <button
                key={item.id}
                className="unread"
                onClick={() => {
                  void notifications.markRead(item.id);
                  if (item.sectionKey && isMainSection(item.sectionKey)) onOpenSection(item.sectionKey);
                  setOpen(false);
                }}
              >
                <span><strong>{notificationSentence(item)}</strong><small>اضغط للقراءة والانتقال</small></span>
                <time>{time.format(new Date(item.createdAt))}</time>
              </button>
            ))}
          </div>
        </aside>
      )}
    </div>
  );
}
