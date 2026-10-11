import assert from 'node:assert/strict';
import { test } from 'node:test';
import { masraweyaAccessState } from '../src/client/sections/masraweya/masraweyaModel.ts';

const current = {
  businessDate: '2026-10-11',
  today: '2026-10-11',
  earliestEditableDate: '2026-10-04',
  openingEditable: true,
  editable: true,
};
test('date editability and write permission determine access without an extra employee restriction', () => {
  assert.equal(masraweyaAccessState(current, true, false).locked, false);
  assert.equal(masraweyaAccessState({ ...current, businessDate: '2026-10-04' }, true, false).locked, false);
  assert.equal(
    masraweyaAccessState({ ...current, businessDate: '2026-10-03', editable: false }, true, false)
      .accessLabel,
    'للقراءة فقط',
  );
  assert.equal(masraweyaAccessState(current, false, false).accessLabel, 'لا توجد صلاحية كتابة');
});
test('loading and an old backend response are not mislabeled as a closed business day', () => {
  assert.equal(masraweyaAccessState(current, true, true).accessLabel, 'جارٍ تحميل اليوم…');
  const oldBackend = masraweyaAccessState({ businessDate: '2026-10-11' }, true, false);
  assert.equal(oldBackend.incompatible, true);
  assert.equal(oldBackend.locked, true);
  assert.equal(oldBackend.accessLabel, 'نسخة الخادم تحتاج تحديثًا');
});
