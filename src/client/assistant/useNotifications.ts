import { uiText, displayLocale } from '../i18n/language.ts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type NotificationItem, type NotificationPreferences } from '../api.ts';
import { useRealtimeRefresh } from '../realtime/useRealtimeRefresh.ts';
import { notificationSentence } from './notificationModel.ts';
import {
  NOTIFICATION_REALTIME_TOPICS,
  NOTIFICATION_SAFETY_POLL_INTERVAL_MS,
} from './notificationRealtime.ts';

let noticeAudioContext: AudioContext | null = null;

async function syncAppBadge(count: number) {
  const badgeNavigator = navigator as Navigator & {
    setAppBadge?: (value?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  try {
    if (count > 0 && badgeNavigator.setAppBadge) await badgeNavigator.setAppBadge(count);
    else if (count === 0 && badgeNavigator.clearAppBadge) await badgeNavigator.clearAppBadge();
  } catch {
    // Badges are optional browser UI; the in-app counter remains authoritative.
  }
}

function resolveNoticeAudioContext() {
  const AudioContextClass = window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;
  noticeAudioContext ??= new AudioContextClass();
  return noticeAudioContext;
}

async function armNoticeTone() {
  const context = resolveNoticeAudioContext();
  if (context?.state === 'suspended') await context.resume().catch(() => undefined);
}

async function playNoticeTone() {
  const context = resolveNoticeAudioContext();
  if (!context) return;
  if (context.state === 'suspended') await context.resume().catch(() => undefined);
  if (context.state !== 'running') return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = 760;
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.2);
}

export function useNotifications(enabled: boolean) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [preferences, setPreferences] = useState<NotificationPreferences>({
    soundEnabled: true,
    speechEnabled: false,
  });
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState<NotificationItem | null>(null);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [preferencesSaving, setPreferencesSaving] = useState(false);
  const [preferencesError, setPreferencesError] = useState('');
  const savingPreferences = useRef(false);
  const initialized = useRef(false);
  const newestId = useRef(0);
  const preferencesRef = useRef(preferences);
  const announcementTimer = useRef<number | null>(null);
  const loadingRequest = useRef(false);

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  const load = useCallback(async () => {
    if (!enabled || loadingRequest.current) return;
    loadingRequest.current = true;
    try {
      const result = await api.notifications();
      const latestId = result.items[0]?.id ?? 0;
      const hasNew = initialized.current && latestId > newestId.current;
      setItems(result.items);
      setUnreadCount(result.unreadCount);
      void syncAppBadge(result.unreadCount);
      setError('');
      if (hasNew && result.items[0]) {
        setAnnouncement(result.items[0]);
        if (announcementTimer.current) window.clearTimeout(announcementTimer.current);
        announcementTimer.current = window.setTimeout(() => setAnnouncement(null), 8_000);
        if (preferencesRef.current.soundEnabled) void playNoticeTone();
        if (preferencesRef.current.speechEnabled && 'speechSynthesis' in window) {
          const speech = new SpeechSynthesisUtterance(
            notificationSentence(result.items[0]),
          );
          speech.lang = displayLocale;
          window.speechSynthesis.speak(speech);
        }
      }
      newestId.current = Math.max(newestId.current, latestId);
      initialized.current = true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : uiText("تعذر تحديث الإشعارات."));
    } finally {
      loadingRequest.current = false;
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void Promise.all([
      load(),
      api.notificationPreferences().then(value => {
        setPreferences(value);
        setPreferencesReady(true);
      }).catch(() => setPreferencesError(uiText("تعذر تحميل إعدادات التنبيه. أعد تحميل الصفحة للمحاولة."))),
    ]);
  }, [enabled, load]);

  useEffect(() => {
    if (!enabled) return;
    const unlock = () => void armNoticeTone();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const recover = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const timer = window.setInterval(recover, NOTIFICATION_SAFETY_POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', recover);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', recover);
    };
  }, [enabled, load]);

  useEffect(() => () => {
    if (announcementTimer.current) window.clearTimeout(announcementTimer.current);
  }, []);

  useRealtimeRefresh({
    topics: NOTIFICATION_REALTIME_TOPICS,
    cursorKey: 'abdo-erp-notifications-cursor',
    enabled,
    fallbackIntervalMs: 4_000,
    onChange: load,
  });

  const markRead = useCallback(async (id: number) => {
    await api.markNotificationRead(id);
    setItems((current) => current.filter((item) => item.id !== id));
    setUnreadCount((current) => {
      const next = Math.max(0, current - 1);
      void syncAppBadge(next);
      return next;
    });
  }, []);

  const markAllRead = useCallback(async () => {
    await api.markAllNotificationsRead();
    setItems([]);
    setUnreadCount(0);
    void syncAppBadge(0);
  }, []);

  const updatePreferences = useCallback(async (next: NotificationPreferences) => {
    if (!preferencesReady || savingPreferences.current) return;
    savingPreferences.current = true;
    setPreferencesSaving(true);
    setPreferencesError('');
    try {
      const saved = await api.updateNotificationPreferences(next);
      preferencesRef.current = saved;
      setPreferences(saved);
    } catch {
      setPreferencesError(uiText("لم يتم حفظ إعدادات التنبيه. الحالة السابقة ما زالت مفعّلة؛ حاول مرة أخرى."));
    } finally {
      savingPreferences.current = false;
      setPreferencesSaving(false);
    }
  }, [preferencesReady]);

  return {
    items,
    unreadCount,
    preferences,
    preferencesReady,
    preferencesSaving,
    preferencesError,
    loading,
    error,
    announcement,
    clearAnnouncement: () => setAnnouncement(null),
    load,
    markRead,
    markAllRead,
    updatePreferences,
  };
}
