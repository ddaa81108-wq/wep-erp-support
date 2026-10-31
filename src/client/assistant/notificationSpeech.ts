type Voice = Pick<SpeechSynthesisVoice, 'lang' | 'voiceURI'>;
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
): boolean {
  let queued = false;
  try {
    for (const part of notificationSpeechParts(text)) {
      const utterance = new SpeechSynthesisUtterance(part);
      utterance.lang = lang;
      utterance.rate = rate;
      if (voice) utterance.voice = voice;
      // Keep the browser's existing queue: a new notice must not cancel the
      // remainder of the notice already being read.
      window.speechSynthesis.speak(utterance);
      queued = true;
    }
  } catch {
    // Speech failure must not be reported as failure to refresh transactions.
  }
  return queued;
}
