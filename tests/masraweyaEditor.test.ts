import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MasraweyaDay } from '../src/client/apiTypes/masraweya.ts';
import { MasraweyaEditor } from '../src/client/sections/masraweya/masraweyaEditor.ts';

function day(overrides: Partial<MasraweyaDay> = {}): MasraweyaDay {
  return {
    id: 'day',
    businessDate: '2026-10-11',
    today: '2026-10-11',
    earliestEditableDate: '2026-10-04',
    editable: true,
    openingEditable: true,
    historicalAdjustmentUnits: 0,
    previousValueUnits: 0,
    purchasesUnits: 0,
    workTotalUnits: 0,
    finalUnits: 0,
    carryValueUnits: null,
    carrySourceDate: null,
    version: 1,
    updatedAt: null,
    updatedByName: null,
    updatedByIsOwner: false,
    entries: [],
    ...overrides,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('autosave serializes requests and keeps typing made while the first save is pending', async () => {
  const first = deferred<MasraweyaDay>();
  const second = deferred<MasraweyaDay>();
  const inputs: Array<{ expectedVersion: number; purchasesUnits: number }> = [];
  const editor = new MasraweyaEditor({
    load: async () => day(),
    save: (input) => {
      inputs.push(input);
      return inputs.length === 1 ? first.promise : second.promise;
    },
  });
  await editor.load();
  editor.edit('purchases', '100');
  const saving = editor.flush();
  editor.edit('purchases', '250');
  assert.equal(inputs.length, 1);
  first.resolve(day({ version: 2, purchasesUnits: 100 }));
  await Promise.resolve();
  assert.equal(editor.snapshot().purchases, '250');
  assert.deepEqual(
    inputs.map((input) => [input.expectedVersion, input.purchasesUnits]),
    [
      [1, 100],
      [2, 250],
    ],
  );
  second.resolve(day({ version: 3, purchasesUnits: 250 }));
  assert.equal(await saving, true);
  assert.equal(editor.snapshot().dirty, false);
  editor.dispose();
});

test('failed saves retain the draft and block a date switch until explicit retry succeeds', async () => {
  let fail = true;
  const loaded: Array<string | undefined> = [];
  const editor = new MasraweyaEditor({
    load: async (date) => {
      loaded.push(date);
      return day({ businessDate: date ?? '2026-10-11' });
    },
    save: async (input) => {
      if (fail) throw new Error('network unavailable');
      return day({ version: 2, purchasesUnits: input.purchasesUnits });
    },
  });
  await editor.load();
  editor.edit('purchases', '120');
  await editor.changeDate('2026-10-10');
  assert.equal(editor.snapshot().purchases, '120');
  assert.equal(editor.snapshot().dirty, true);
  assert.match(editor.snapshot().error, /network/);
  assert.deepEqual(loaded, [undefined]);
  fail = false;
  await editor.changeDate('2026-10-10');
  assert.equal(editor.snapshot().day?.businessDate, '2026-10-10');
  editor.dispose();
});

test('incomplete negative and unsafe values are never transmitted as zero or rounded numbers', async () => {
  const values: number[] = [];
  const editor = new MasraweyaEditor({
    load: async () => day(),
    save: async (input) => {
      values.push(input.previousValueUnits);
      return day({ version: 2 });
    },
  });
  await editor.load();
  editor.edit('previous', '-');
  assert.equal(await editor.flush(), false);
  assert.deepEqual(values, []);
  editor.edit('previous', '-123');
  assert.equal(editor.snapshot().error, '');
  assert.equal(await editor.flush(), true);
  assert.deepEqual(values, [-123]);
  editor.edit('previous', '9007199254740992');
  assert.equal(await editor.flush(), false);
  assert.deepEqual(values, [-123]);
  editor.dispose();
});

test('a clean editor follows the 04:00 day change but refresh never replaces an unsaved draft', async () => {
  let next = day();
  const editor = new MasraweyaEditor({ load: async () => next, save: async () => next });
  await editor.load();
  editor.editRow(2, 'value', '99');
  next = day({ businessDate: '2026-10-12', today: '2026-10-12', previousValueUnits: 400 });
  await editor.refresh(true);
  assert.equal(editor.snapshot().day?.businessDate, '2026-10-11');
  assert.equal(editor.snapshot().rows[2].value, '99');
  // Explicit reload intentionally discards a draft only after the UI confirmation.
  await editor.load();
  assert.equal(editor.snapshot().previous, '400');
  next = day({ businessDate: '2026-10-13', today: '2026-10-13' });
  await editor.refresh(true);
  assert.equal(editor.snapshot().day?.businessDate, '2026-10-13');
  editor.dispose();
});

test('autosave debounce saves the latest value and preserves blank row positions', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const writes: number[] = [];
  const editor = new MasraweyaEditor({
    load: async () => day({ entries: [{ id: 'row', sequence: 3, valueUnits: 25, commissionUnits: 2 }] }),
    save: async (input) => {
      writes.push(input.purchasesUnits);
      return day({ version: 2 });
    },
  });
  await editor.load();
  assert.equal(editor.snapshot().rows[0].value, '');
  assert.equal(editor.snapshot().rows[2].value, '25');
  editor.edit('purchases', '1');
  context.mock.timers.tick(400);
  editor.edit('purchases', '123');
  context.mock.timers.tick(599);
  assert.deepEqual(writes, []);
  context.mock.timers.tick(1);
  await editor.flush();
  assert.deepEqual(writes, [123]);
  editor.dispose();
});

test('background refreshes coalesce and cannot overwrite edits or a disposed editor', async () => {
  const pending = deferred<MasraweyaDay>();
  let calls = 0;
  const editor = new MasraweyaEditor({
    load: async () => ++calls === 1 ? day() : pending.promise,
    save: async () => day(),
  });
  await editor.load();
  const first = editor.refresh(true);
  const second = editor.refresh(true);
  assert.equal(first, second);
  assert.equal(calls, 2);
  editor.edit('purchases', '25');
  pending.resolve(day({ version: 2, purchasesUnits: 99 }));
  await first;
  assert.equal(editor.snapshot().purchases, '25');
  editor.dispose();
});

test('failed background reads remain retryable instead of acknowledging stale day data', async () => {
  let calls = 0;
  const editor = new MasraweyaEditor({
    load: async () => {
      if (++calls === 2) throw new Error('Transient refresh failure');
      return day({ version: calls });
    },
    save: async () => day(),
  });
  await editor.load();
  await assert.rejects(editor.refresh(), /Transient refresh failure/);
  assert.equal(editor.snapshot().day?.version, 1);
  await editor.refresh();
  assert.equal(editor.snapshot().day?.version, 3);
  editor.dispose();
});

test('duplicate initial loads are ignored while a read is pending', async () => {
  const pending = deferred<MasraweyaDay>();
  let calls = 0;
  const editor = new MasraweyaEditor({
    load: () => { calls++; return pending.promise; },
    save: async () => day(),
  });
  const first = editor.load();
  await editor.load();
  assert.equal(calls, 1);
  pending.resolve(day());
  await first;
  assert.equal(editor.snapshot().loading, false);
  editor.dispose();
});

test('cleanup allows a remount to load and ignores the previous pending result', async () => {
  const old = deferred<MasraweyaDay>();
  let calls = 0;
  const editor = new MasraweyaEditor({
    load: () => ++calls === 1 ? old.promise : Promise.resolve(day({ version: 3 })),
    save: async () => day(),
  });
  const abandoned = editor.load();
  editor.dispose();
  await editor.load();
  old.resolve(day({ version: 1 }));
  await abandoned;
  assert.equal(editor.snapshot().day?.version, 3);
  assert.equal(editor.snapshot().loading, false);
  editor.dispose();
});
