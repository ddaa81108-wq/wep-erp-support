import { uiText, displayLocale } from '../i18n/language.ts';
import { BrowserPushControls } from './BrowserPushControls.tsx';
import { Bell, BellRing, CheckCheck, ChevronLeft, MessageSquareText, Volume2, VolumeX, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { User } from '../api.ts';
import { isMainSection, type MainSection } from '../../shared/sections.ts';
import { useNotifications } from './useNotifications.ts';
import { notificationSentence } from './notificationModel.ts';

const time = new Intl.DateTimeFormat(displayLocale, { dateStyle: 'short', timeStyle: 'short' });

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
    if (!unread.length) return uiText("لا توجد حركات جديدة تحتاج مراجعتك.");
    const actors = new Map<string, number>();
    unread.forEach((item) => actors.set(item.actorName, (actors.get(item.actorName) ?? 0) + 1));
    const busiest = [...actors].sort((a, b) => b[1] - a[1])[0];
    return uiText("{0} حركة غير مقروءة، وأكثرها بواسطة {1} ({2}).", [unread.length, busiest[0], busiest[1]]);
  }, [notifications.items]);

  if (!enabled) return null;
  return (
    <div className="notification-center">
      {notifications.announcement && (
        <button
          className="notification-toast"
          aria-label={uiText("إشعار جديد")}
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
        aria-label={uiText("الإشعارات")}
        title={uiText("الإشعارات")}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {notifications.unreadCount ? <BellRing size={19} /> : <Bell size={19} />}
        {notifications.unreadCount > 0 && <b>{Math.min(99, notifications.unreadCount)}</b>}
      </button>
      {open && (
        <aside className="notification-panel" aria-label={user.role === 'admin' ? uiText("مركز مراجعة الإدارة") : uiText("مركز الإشعارات")}>
          <header>
            <span className="notification-heading-icon" aria-hidden="true"><BellRing size={21} /></span>
            <div><strong>{user.role === 'admin' ? uiText("مركز مراجعة الإدارة") : uiText("الإشعارات")}</strong><small><b>{notifications.unreadCount}</b> {uiText(" حركة تحتاج قراءة")}</small></div>
            <button aria-label={uiText("إغلاق")} onClick={() => setOpen(false)}><X size={17} /></button>
          </header>
          <div className="notification-insight">
            <strong>{uiText("ملخص آلي للمراجعة")}</strong>
            <span>{insight}</span>
          </div>
          <div className="notification-actions">
            <button className="notification-mark-all" aria-label={uiText("تعليم الكل كمقروء")} disabled={!notifications.unreadCount} onClick={() => void notifications.markAllRead()}>
              <CheckCheck size={15} /> {uiText(" قراءة الكل")}</button>
            <button
              className="notification-toggle"
              disabled={!notifications.preferencesReady || notifications.preferencesSaving}
              aria-busy={notifications.preferencesSaving}
              aria-pressed={notifications.preferences.soundEnabled}
              title={notifications.preferences.soundEnabled ? uiText("إيقاف الصوت") : uiText("تشغيل الصوت")}
              onClick={() => void notifications.updatePreferences({
                ...notifications.preferences,
                soundEnabled: !notifications.preferences.soundEnabled,
              })}
            >
              {notifications.preferences.soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
              <span>{uiText("الصوت")}<strong>{!notifications.preferencesReady ? uiText("جارٍ التحميل…") : notifications.preferences.soundEnabled ? uiText("مفعّل") : uiText("متوقف")}</strong></span>
            </button>
            <button
              className="notification-toggle"
              disabled={!notifications.preferencesReady || notifications.preferencesSaving}
              aria-busy={notifications.preferencesSaving}
              aria-pressed={notifications.preferences.speechEnabled}
              title={notifications.preferences.speechEnabled ? uiText("إيقاف النطق") : uiText("تشغيل النطق")}
              onClick={() => void notifications.updatePreferences({
                ...notifications.preferences,
                speechEnabled: !notifications.preferences.speechEnabled,
              })}
            >
              <MessageSquareText size={15} />
              <span>{uiText("النطق")}<strong>{!notifications.preferencesReady ? uiText("جارٍ التحميل…") : notifications.preferences.speechEnabled ? uiText("مفعّل") : uiText("متوقف")}</strong></span>
            </button>
          </div>
          <BrowserPushControls />
          {notifications.preferencesSaving && <p className="notification-preference-status" role="status">{uiText("جارٍ حفظ إعدادات التنبيه…")}</p>}
          {notifications.preferencesError && <p className="notification-error" role="alert">{notifications.preferencesError}</p>}
          {notifications.error && <p className="notification-error">{notifications.error}</p>}
          <div className="notification-list-heading"><strong>{uiText("آخر الحركات")}</strong><span>{uiText("الأحدث أولًا")}</span></div>
          <div className="notification-list">
            {notifications.loading && <p>{uiText("جارٍ تحميل الإشعارات…")}</p>}
            {!notifications.loading && notifications.items.length === 0 && <p className="notification-empty"><CheckCheck size={26} aria-hidden="true" /><strong>{uiText("لا توجد إشعارات حتى الآن.")}</strong><span>{uiText("ستظهر الحركات الجديدة هنا.")}</span></p>}
            {notifications.items.map((item) => (
              <button
                key={item.id}
                className={item.readAt ? '' : 'unread'}
                onClick={() => {
                  void notifications.markRead(item.id);
                  if (item.sectionKey && isMainSection(item.sectionKey)) onOpenSection(item.sectionKey);
                  setOpen(false);
                }}
              >
                <span><strong>{notificationSentence(item)}</strong><time dateTime={item.createdAt}>{time.format(new Date(item.createdAt))}</time></span>
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
            ))}
          </div>
        </aside>
      )}
    </div>
  );
}
