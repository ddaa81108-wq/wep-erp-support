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
