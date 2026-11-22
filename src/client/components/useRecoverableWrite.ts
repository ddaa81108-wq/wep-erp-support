import { useRef, useState } from 'react';
import { ApiError } from '../apiTransport.ts';
import { uiText } from '../i18n/language.ts';

type Attempt<T> = { requestId: string; payload: T };

function readAttempt<T>(key: string): Attempt<T> | null {
  const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
  if (value === null) return null;
  if (
    typeof value !== 'object' ||
    !('requestId' in value) ||
    typeof value.requestId !== 'string' ||
    value.requestId.length < 8 ||
    !('payload' in value) ||
    !value.payload ||
    typeof value.payload !== 'object'
  )
    throw new Error(uiText('تعذر قراءة سجل المحاولة السابقة. راجع الدعم قبل إرسال عملية جديدة.'));
  return value as Attempt<T>;
}

/** Persist before sending. An unknown reply must be retried with the original
 * payload and identity, including after a reload. Keys must include the user ID. */
export function useRecoverableWrite<T extends object>(key: string) {
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Attempt<T> | null>(() => {
    try {
      return readAttempt<T>(key);
    } catch {
      return null;
    }
  });
  async function run(
    payload: T | null,
    send: (payload: T, requestId: string) => Promise<unknown>,
    confirmed: (payload: T) => void,
  ) {
    if (locked.current) return false;
    locked.current = true;
    setBusy(true);
    try {
      const previous = readAttempt<T>(key);
      if (previous && payload !== null && JSON.stringify(previous.payload) !== JSON.stringify(payload))
        throw new Error(
          uiText('توجد محاولة لم يتأكد ردها. أعد التحقق من العملية السابقة قبل تسجيل عملية جديدة.'),
        );
      if (!previous && payload === null) {
        setPending(null);
        return false;
      }
      const attempt = previous ?? { requestId: crypto.randomUUID(), payload: payload! };
      // Fail closed if browser storage is unavailable; never send an untracked write.
      try {
        localStorage.setItem(key, JSON.stringify(attempt));
      } catch {
        throw new Error(uiText('تعذر حفظ مفتاح الطلب على هذا الجهاز. لم يتم إرسال عملية جديدة.'));
      }
      setPending(attempt);
      try {
        await send(attempt.payload, attempt.requestId);
      } catch (error) {
        // Only a definitive rejection of a fresh request permits a replacement.
        // Even 403 during recovery cannot prove the earlier attempt was rejected.
        if (
          !previous &&
          error instanceof ApiError &&
          [400, 401, 403, 404, 409].includes(error.status) &&
          ![
            'REQUEST_ID_REUSED',
            'IDEMPOTENCY_KEY_REUSED',
            'INVALID_SERVER_RESPONSE',
            'REQUEST_FAILED',
            'LEGACY_REQUEST_REVIEW_REQUIRED',
          ].includes(error.code)
        ) {
          localStorage.removeItem(key);
          setPending(null);
        }
        throw error;
      }
      // Clear the form on acknowledgement, before the subsequent dashboard read.
      confirmed(attempt.payload);
      localStorage.removeItem(key);
      setPending(null);
      return true;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return { busy, pending, run };
}
