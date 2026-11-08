import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/server/db/database.ts';
import { fixtureAdmin } from './helpers/financialFixture.ts';
import { getNotificationSpeech, updateNotificationSpeech } from '../src/server/domain/notificationSpeech.ts';
import {
  egyptianVoices,
  selectEgyptianVoice,
  spokenNotificationText,
  notificationSpeechParts,
  selectSpeechVoice,
  enqueueNotificationSpeech,
  resetNotificationSpeech,
  type SpeechPlaybackStatus,
} from '../src/client/assistant/notificationSpeech.ts';

test('Egyptian speech is opt-in, account-scoped, admin-only and validates settings', () => {
  const db = openDatabase(':memory:');
  try {
    const admin = fixtureAdmin(db);
    db.prepare(
      `INSERT INTO users(id,username,display_name,password_hash,role,organization_id,home_branch_id,created_at,updated_at)
      SELECT 'other-admin','other-admin','Other',password_hash,role,organization_id,home_branch_id,created_at,updated_at FROM users WHERE id=?`,
    ).run(admin.id);
    const other = { ...admin, id: 'other-admin' };
    assert.equal(getNotificationSpeech(db, admin).profile, 'default');
    const settings = { profile: 'egyptian', voiceURI: 'Egyptian test voice', rate: 0.9 };
    assert.deepEqual(updateNotificationSpeech(db, admin, settings), settings);
    assert.deepEqual(getNotificationSpeech(db, { ...admin }), settings);
    assert.equal(getNotificationSpeech(db, other).profile, 'default');
    for (const input of [
      { ...settings, rate: 5 },
      { ...settings, rate: NaN },
      { ...settings, voiceURI: 'a'.repeat(501) },
      { ...settings, profile: 'bogus' },
    ])
      assert.throws(() => updateNotificationSpeech(db, admin, input));
    const employee = { ...admin, role: 'employee' as const };
    assert.throws(() => getNotificationSpeech(db, employee));
    assert.throws(() => updateNotificationSpeech(db, employee, settings));
    assert.deepEqual(getNotificationSpeech(db, admin), settings);
    assert.equal(updateNotificationSpeech(db, admin, { ...settings, profile: 'clear' }).profile, 'clear');
    assert.equal(getNotificationSpeech(db, other).profile, 'default');
  } finally {
    db.close();
  }
});

test('speech locale resolves to an available voice of the same language without substituting a different language', () => {
  const voices = [{ lang: 'en-US', voiceURI: 'en', default: true }, { lang: 'ar-SA', voiceURI: 'ar' }];
  assert.equal(selectSpeechVoice(voices, 'ar-LY')?.voiceURI, 'ar');
  assert.equal(selectSpeechVoice(voices, 'en-GB')?.voiceURI, 'en');
  assert.equal(selectSpeechVoice(voices, 'fr-FR'), undefined);
});

test('speech reports asynchronous failures and real playback events; explicit reset ignores stale callbacks without replay', () => {
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const savedUtterance = Object.getOwnPropertyDescriptor(globalThis, 'SpeechSynthesisUtterance');
  const states: SpeechPlaybackStatus[] = [];
  class Utterance {
    text: string; lang = ''; rate = 1; voice: unknown;
    onstart?: () => void; onend?: () => void; onerror?: (event: { error: string }) => void;
    constructor(text: string) { this.text = text; }
  }
  const spoken: Utterance[] = [];
  const timers = new Map<number, () => void>();
  let timerId = 0, cancels = 0, resumes = 0, failSync = false;
  const synth = {
    getVoices: () => [{ lang: 'ar-SA', voiceURI: 'test-ar' }],
    speak: (u: Utterance) => { if (failSync) throw new Error('engine failure'); spoken.push(u); },
    cancel: () => { cancels++; spoken.forEach(u => u.onerror?.({ error: 'canceled' })); },
    resume: () => { resumes++; },
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    speechSynthesis: synth,
    dispatchEvent: (event: CustomEvent<SpeechPlaybackStatus>) => { states.push(event.detail); return true; },
    setTimeout: (callback: () => void) => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: (id: number) => { timers.delete(id); },
  } });
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', { configurable: true, value: Utterance });
  try {
    assert.equal(enqueueNotificationSpeech('تجربة صوت', 'ar-LY', 1, undefined, { watchStart: true }), true);
    assert.equal(spoken[0].lang, 'ar-SA');
    spoken[0].onerror?.({ error: 'not-allowed' });
    assert.deepEqual(states.at(-1), { phase: 'error', code: 'not-allowed' });
    assert.equal(spoken.length, 1, 'A playback error must not silently retry or duplicate the sentence');
    assert.equal(cancels, 0, 'New notifications do not cancel existing speech');
    resetNotificationSpeech();
    assert.equal(cancels, 1); assert.equal(resumes, 1);
    assert.equal(states.at(-1)!.phase, 'reset');
    enqueueNotificationSpeech('تجربة جديدة', 'ar-LY', 1);
    spoken[1].onstart?.();
    spoken[0].onerror?.({ error: 'network' });
    spoken[0].onend?.();
    assert.equal(states.at(-1)!.phase, 'started', 'Callbacks from cancelled work cannot overwrite the new test');
    spoken[1].onend?.();
    assert.equal(states.at(-1)!.phase, 'finished');
    enqueueNotificationSpeech('تجربة انتظار', 'ar-LY', 1, undefined, { watchStart: true });
    for (const timer of timers.values()) timer();
    assert.equal(states.at(-1)!.phase, 'waiting');
    assert.equal(spoken.length, 3, 'A start timeout reports state but does not replay text');
    failSync = true;
    assert.equal(enqueueNotificationSpeech('تجربة فشل', 'ar-LY', 1), false);
    assert.deepEqual(states.at(-1), { phase: 'error', code: 'synthesis-failed' });
    resetNotificationSpeech();
  } finally {
    if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow); else Reflect.deleteProperty(globalThis, 'window');
    if (savedUtterance) Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', savedUtterance); else Reflect.deleteProperty(globalThis, 'SpeechSynthesisUtterance');
  }
});

test('current voice keeps all long-notice words, amounts and signs while expanding currency names', () => {
  const text =
    'الموظف أحمد سجّل تسديدًا بقيمة 1,234,567 د.ل. ' +
    'تفاصيل المعاملة كاملة. '.repeat(40) +
    'باقي الحساب -250 ج.م.';
  const parts = notificationSpeechParts(text);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((part) => part.length <= 160));
  assert.equal(parts.join(' '), spokenNotificationText(text).trim().replace(/\s+/gu, ' '));
  assert.ok(parts[0].includes('1234567 دينار ليبي'));
  assert.ok(parts.at(-1)!.includes('-250 جنيه مصري'));
  assert.deepEqual(notificationSpeechParts('  '), []);
  assert.equal(spokenNotificationText('12.5 و1,23 والعميل أحمد'), '12.5 و1,23 والعميل أحمد');
});

test('Egyptian voice resolution never mistakes another locale for Egyptian and expands currency only for speech', () => {
  const voices = [
    { lang: 'ar-SA', voiceURI: 'saudi' },
    { lang: 'ar-EG', voiceURI: 'egypt-one' },
    { lang: 'ar_EG', voiceURI: 'egypt-two' },
  ];
  assert.equal(egyptianVoices(voices).length, 2);
  assert.equal(selectEgyptianVoice(voices, 'egypt-two')?.voiceURI, 'egypt-two');
  assert.equal(selectEgyptianVoice(voices, 'missing-device-voice')?.voiceURI, 'egypt-one');
  assert.equal(selectEgyptianVoice(voices.slice(0, 1), ''), undefined);
  assert.equal(spokenNotificationText('150 د.ل و200 ج.م'), '150 دينار ليبي و200 جنيه مصري');
});
