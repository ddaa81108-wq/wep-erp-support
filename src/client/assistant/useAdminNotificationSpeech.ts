import { useCallback, useEffect, useRef, useState } from 'react';
import {
  defaultNotificationSpeech,
  type NotificationSpeechSettings,
} from '../../shared/notificationSpeech.ts';
import { request } from '../apiTransport.ts';
import { displayLocale, uiText } from '../i18n/language.ts';
import { enqueueNotificationSpeech, egyptianVoices, selectEgyptianVoice, resetNotificationSpeech, speechPlaybackMessage, SPEECH_PLAYBACK_EVENT, type SpeechPlaybackStatus } from './notificationSpeech.ts';

export function useAdminNotificationSpeech(enabled: boolean) {
  const [settings, setSettings] = useState({ ...defaultNotificationSpeech });
  const current = useRef(settings);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const revision = useRef(0);
  const [error, setError] = useState('');
  const [playback, setPlayback] = useState<SpeechPlaybackStatus | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const update = (event: Event) => setPlayback((event as CustomEvent<SpeechPlaybackStatus>).detail);
    window.addEventListener(SPEECH_PLAYBACK_EVENT, update);
    return () => window.removeEventListener(SPEECH_PLAYBACK_EVENT, update);
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const load = () => {
      if (saving.current) return;
      const requestRevision = ++revision.current;
      void request<NotificationSpeechSettings>('/api/notification-speech')
        .then((value) => {
          if (active && requestRevision === revision.current) {
            current.current = value;
            setSettings(value);
            setReady(true);
            setError('');
          }
        })
        .catch(() => {
          if (active && requestRevision === revision.current)
            setError(uiText('تعذر تحميل إعدادات الصوت. أعد فتح الصفحة للمحاولة.'));
        });
    };
    load();
    window.addEventListener('focus', load);
    return () => {
      active = false;
      window.removeEventListener('focus', load);
    };
  }, [enabled]);
  useEffect(() => {
    if (!enabled || !('speechSynthesis' in window)) return;
    const synth = window.speechSynthesis;
    const load = () => setVoices(egyptianVoices(synth.getVoices()));
    load();
    synth.addEventListener('voiceschanged', load);
    return () => synth.removeEventListener('voiceschanged', load);
  }, [enabled]);
  const save = async (value: NotificationSpeechSettings) => {
    if (!ready || saving.current) return;
    ++revision.current;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await request<NotificationSpeechSettings>('/api/notification-speech', {
        method: 'PATCH',
        body: JSON.stringify(value),
      });
      current.current = result;
      setSettings(result);
    } catch {
      setError(uiText('لم يتم حفظ إعدادات الصوت. الإعداد السابق ما زال مستخدمًا.'));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  const speak = useCallback((text: string) => {
    if (current.current.profile === 'default') return false;
    const voice =
      current.current.profile === 'egyptian'
        ? selectEgyptianVoice(window.speechSynthesis?.getVoices() ?? [], current.current.voiceURI)
        : undefined;
    enqueueNotificationSpeech(text, voice ? 'ar-EG' : displayLocale, current.current.rate, voice);
    return true; // A reported failure must not trigger a second fallback speech request.
  }, []);
  const preview = () => {
    const voice =
      settings.profile === 'egyptian'
        ? selectEgyptianVoice(window.speechSynthesis?.getVoices() ?? [], settings.voiceURI)
        : undefined;
    if (settings.profile === 'egyptian' && !voice) return;
    const text =
      settings.profile === 'egyptian'
        ? uiText('أهلًا بيك. دي تجربة صوت الإشعارات المصري. تم تسجيل تسديد بقيمة 150 دينار ليبي.')
        : uiText(
            'هذه تجربة وضوح النطق بالصوت الحالي. الموظف أحمد سجّل تسديدًا جزئيًا للعميل محمد بقيمة 1,500 د.ل. وسجّل استهلاك فودافون بقيمة 250 ج.م. هذه بيانات تجريبية فقط.',
          );
    enqueueNotificationSpeech(text, voice ? 'ar-EG' : displayLocale, settings.profile === 'default' ? 1 : settings.rate, voice, { watchStart: true });
  };
  return {
    settings,
    voices,
    ready,
    busy,
    error,
    save,
    speak,
    preview,
    retryPreview: () => { if (resetNotificationSpeech()) preview(); },
    playback,
    playbackMessage: playback ? uiText(speechPlaybackMessage(playback)) : '',
    supported: typeof window !== 'undefined' && 'speechSynthesis' in window,
  };
}
