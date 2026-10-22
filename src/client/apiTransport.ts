import { uiText } from './i18n/language.ts';
import { isApiFailure, isApiSuccess } from '../shared/httpContracts.ts';
import { serverErrorText } from './i18n/serverMessages.ts';

export const API_VERSION = '1';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(serverErrorText(code, message));
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let csrfToken = '';
const csrfChannel =
  typeof window === 'undefined' || typeof BroadcastChannel === 'undefined'
    ? null
    : new BroadcastChannel('abdo-erp-session');
if (csrfChannel) {
  csrfChannel.onmessage = (event: MessageEvent<unknown>) => {
    if (typeof event.data === 'string') csrfToken = event.data;
  };
}

export function rememberCsrf(token: string) {
  csrfToken = token;
  csrfChannel?.postMessage(token);
}

export async function request<T>(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  headers.set('X-Client-Api-Version', API_VERSION);
  if (init.body) headers.set('Content-Type', 'application/json');
  if (init.method && init.method !== 'GET' && csrfToken) headers.set('X-CSRF-Token', csrfToken);
  let response: Response;
  const method = (init.method ?? 'GET').toUpperCase();
  const tracksSaving = method !== 'GET' && method !== 'HEAD';
  if (typeof window !== 'undefined' && tracksSaving) window.dispatchEvent(new Event('abdo:request-start'));
  try {
    response = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  } catch {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('abdo:internet-unavailable'));
      if (tracksSaving) window.dispatchEvent(new Event('abdo:request-error'));
    }
    throw new ApiError(0, 'NETWORK_UNAVAILABLE', uiText("تعذر تنفيذ الطلب."));
  }
  const signalWrite = (event: 'abdo:request-finish' | 'abdo:request-error') => {
    if (typeof window !== 'undefined' && tracksSaving) window.dispatchEvent(new Event(event));
  };
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    signalWrite('abdo:request-error');
    throw new ApiError(
      response.status,
      'INVALID_SERVER_RESPONSE',
      uiText("استجابة الخادم غير صالحة. أعد المحاولة أو راجع حالة الخدمة."),
    );
  }
  if (!response.ok || isApiFailure(payload)) {
    signalWrite('abdo:request-error');
    const failure = isApiFailure(payload) ? payload : null;
    throw new ApiError(
      response.status,
      failure?.error.code ?? 'REQUEST_FAILED',
      failure?.error.message ?? uiText("تعذر تنفيذ الطلب."),
      failure?.error.details,
    );
  }
  if (!isApiSuccess<T>(payload)) {
    signalWrite('abdo:request-error');
    throw new ApiError(response.status, 'INVALID_SERVER_RESPONSE', uiText("استجابة الخادم غير مكتملة."));
  }
  signalWrite('abdo:request-finish');
  return payload.data;
}
