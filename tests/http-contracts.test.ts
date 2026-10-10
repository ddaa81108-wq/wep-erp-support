import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isApiFailure, isApiSuccess } from '../src/shared/httpContracts.ts';

test('API response guards accept only complete success and failure envelopes', () => {
  assert.equal(isApiSuccess({ ok: true, data: { id: 1 } }), true);
  assert.equal(isApiSuccess({ ok: true }), false);
  assert.equal(isApiSuccess({ ok: false, data: {} }), false);

  assert.equal(
    isApiFailure({ ok: false, error: { code: 'DENIED', message: 'غير مسموح' } }),
    true,
  );
  assert.equal(isApiFailure({ ok: false, error: { message: 'ناقص' } }), false);
  assert.equal(isApiFailure('<html>proxy error</html>'), false);
});
