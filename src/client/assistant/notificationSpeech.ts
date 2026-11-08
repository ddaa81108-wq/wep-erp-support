type Voice = Pick<SpeechSynthesisVoice, 'lang' | 'voiceURI'>;
export const SPEECH_PLAYBACK_EVENT = 'abdo:notification-speech-playback';
export type SpeechPlaybackStatus = {
  phase: 'queued' | 'started' | 'finished' | 'waiting' | 'error' | 'reset';
  code?: string;
};
export function speechPlaybackMessage(status: SpeechPlaybackStatus): string {
  if (status.phase === 'queued') return 'أُرسل طلب النطق؛ ننتظر تأكيد المتصفح.';
  if (status.phase === 'started') return 'المتصفح أكد بدء النطق. إذا لم تسمع، راجع صوت الموقع والجهاز.';
  if (status.phase === 'finished') return 'انتهى طلب النطق لدى المتصفح. إذا لم تسمع، راجع كتم الصوت ومخرج الصوت في الجهاز.';
  if (status.phase === 'waiting') return 'لم يؤكد المتصفح بدء التجربة. قد يكون طابور الصوت عالقًا أو التشغيل محجوبًا؛ جرّب إعادة التهيئة.';
  if (status.phase === 'reset') return 'أُعيدت تهيئة طابور الصوت على هذا الجهاز.';
  const messages: Record<string, string> = {
    unsupported: 'هذا المتصفح لا يوفّر محرك النطق. جرّب متصفحًا يدعم النطق على هذا الجهاز.',
    'not-allowed': 'المتصفح منع تشغيل النطق. اسمح بالصوت للموقع واضغط إعادة تهيئة الصوت وتجربته.',
    'audio-busy': 'محرك الصوت مشغول. جرّب إعادة تهيئة الصوت وتجربته.',
    'audio-hardware': 'تعذر الوصول إلى مخرج الصوت. راجع السماعات ومخرج الصوت في الجهاز.',
    network: 'تعذر اتصال محرك الصوت بخدمته. راجع الاتصال أو اختر صوتًا محليًا من إعدادات الجهاز.',
    'language-unavailable': 'لا يتوفر صوت مناسب للغة المطلوبة. راجع أصوات النطق العربية المثبتة في الجهاز.',
    'voice-unavailable': 'الصوت المختار غير متاح على هذا الجهاز. اختر صوتًا متاحًا أو صوت الجهاز المعتاد.',
    'synthesis-unavailable': 'محرك النطق غير متاح في الجهاز. راجع إعدادات تحويل النص إلى كلام.',
    'synthesis-failed': 'فشل محرك النطق في تشغيل الصوت. جرّب إعادة تهيئة الصوت وتجربته.',
    'text-too-long': 'محرك الصوت رفض طول النص. جرّب إعادة تهيئة الصوت وتجربته.',
    interrupted: 'توقّف تشغيل النطق قبل اكتماله. جرّب تجربة الصوت من جديد.',
    canceled: 'أُلغي تشغيل النطق قبل اكتماله. جرّب تجربة الصوت من جديد.',
  };
  return messages[status.code ?? ''] ?? 'تعذر تشغيل النطق على هذا الجهاز. جرّب إعادة التهيئة وراجع إعدادات الصوت.';
}
let playbackGeneration = 0;
const retainedUtterances = new Set<SpeechSynthesisUtterance>();
const startTimers = new Set<number>();
function reportPlayback(status: SpeechPlaybackStatus) {
  window.dispatchEvent(new CustomEvent<SpeechPlaybackStatus>(SPEECH_PLAYBACK_EVENT, { detail: status }));
}
export function selectSpeechVoice<T extends Voice & { default?: boolean }>(voices: T[], lang: string): T | undefined {
  const normalized = lang.replaceAll('_', '-').toLowerCase();
  const family = normalized.split('-')[0];
  return voices.find(voice => voice.lang.replaceAll('_', '-').toLowerCase() === normalized)
    ?? voices.find(voice => voice.default && voice.lang.split(/[-_]/)[0].toLowerCase() === family)
    ?? voices.find(voice => voice.lang.split(/[-_]/)[0].toLowerCase() === family);
}
/** Explicit user action only. Never reset/replay automatically when new notices arrive. */
export function resetNotificationSpeech() {
  playbackGeneration++;
  for (const timer of startTimers) window.clearTimeout(timer);
  startTimers.clear();
  retainedUtterances.clear();
  try {
    if (!('speechSynthesis' in window)) { reportPlayback({ phase: 'error', code: 'unsupported' }); return false; }
    window.speechSynthesis.cancel();
    window.speechSynthesis.resume();
    reportPlayback({ phase: 'reset' });
    return true;
  } catch { reportPlayback({ phase: 'error', code: 'synthesis-failed' }); return false; }
}
export function egyptianVoices<T extends Voice>(voices: T[]): T[] {
  return voices.filter((voice) => voice.lang.replaceAll('_', '-').toLowerCase() === 'ar-eg');
}
export function selectEgyptianVoice<T extends Voice>(voices: T[], preferred: string): T | undefined {
  const available = egyptianVoices(voices);
  return available.find((voice) => voice.voiceURI === preferred) ?? available[0];
}
export function spokenNotificationText(text: string) {
  return text
    .replace(/د\.ل/gu, 'دينار ليبي')
    .replace(/ج\.م/gu, 'جنيه مصري')
    .replace(/\b\d{1,3}(?:,\d{3})+\b/gu, (amount) => amount.replaceAll(',', ''));
}

// Short, word-aligned utterances avoid sending an entire long notification to
// a browser speech engine at once. Joining them preserves every spoken word.
export function notificationSpeechParts(text: string): string[] {
  const words = spokenNotificationText(text).trim().split(/\s+/u).filter(Boolean);
  const parts: string[] = [];
  for (const word of words) {
    const last = parts.length - 1;
    if (last < 0 || parts[last].length + word.length + 1 > 160) parts.push(word);
    else parts[last] += ' ' + word;
  }
  return parts;
}

export function enqueueNotificationSpeech(
  text: string,
  lang: string,
  rate: number,
  voice?: SpeechSynthesisVoice,
  options: { watchStart?: boolean } = {},
): boolean {
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
    reportPlayback({ phase: 'error', code: 'unsupported' });
    return false;
  }
  const generation = playbackGeneration;
  const parts = notificationSpeechParts(text);
  if (!parts.length) return false;
  let started = false, failed = false, completed = 0;
  let timer: number | undefined;
  const clearStartTimer = () => {
    if (timer !== undefined) { window.clearTimeout(timer); startTimers.delete(timer); timer = undefined; }
  };
  const fail = (code: string) => {
    clearStartTimer();
    if (generation !== playbackGeneration || failed) return;
    failed = true;
    reportPlayback({ phase: 'error', code });
  };
  let queued = false;
  try {
    const resolvedVoice = voice ?? selectSpeechVoice(window.speechSynthesis.getVoices(), lang);
    reportPlayback({ phase: 'queued' });
    if (options.watchStart) {
      timer = window.setTimeout(() => {
        if (timer !== undefined) startTimers.delete(timer);
        if (!started && !failed && generation === playbackGeneration) reportPlayback({ phase: 'waiting' });
      }, 12000);
      startTimers.add(timer);
    }
    for (const part of parts) {
      const utterance = new SpeechSynthesisUtterance(part);
      utterance.lang = resolvedVoice?.lang ?? lang;
      utterance.rate = rate;
      if (resolvedVoice) utterance.voice = resolvedVoice;
      retainedUtterances.add(utterance);
      utterance.onstart = () => {
        clearStartTimer();
        if (generation !== playbackGeneration || failed) return;
        if (!started) { started = true; reportPlayback({ phase: 'started' }); }
      };
      utterance.onend = () => {
        retainedUtterances.delete(utterance);
        completed++;
        if (generation === playbackGeneration && !failed && completed === parts.length) {
          clearStartTimer(); reportPlayback({ phase: 'finished' });
        }
      };
      utterance.onerror = event => { retainedUtterances.delete(utterance); fail(event.error); };
      // Keep the browser's existing queue: a new notice must not cancel the
      // remainder of the notice already being read.
      try { window.speechSynthesis.speak(utterance); }
      catch (error) { retainedUtterances.delete(utterance); throw error; }
      queued = true;
    }
  } catch {
    fail('synthesis-failed');
  }
  return queued;
}
