import { uiText } from './i18n/language.ts';
import { isApiFailure, isApiSuccess } from '../shared/httpContracts.ts';
import { serverErrorText } from './i18n/serverMessages.ts';
import { PendingReads } from './pendingReads.ts';
import { confirmDuplicate, duplicateAwareInput } from './components/duplicatePrompt.ts';

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
const pendingReads = new PendingReads();
// Application-memory conditional snapshots only; never persist across sessions.
let conditionalGeneration=0;
const conditionalReads=new Map<string,{etag:string;data:unknown}>();
function clearConditionalReads(){conditionalGeneration++;conditionalReads.clear();}
/** A remote commit invalidates reads that began before its live event. */
export function invalidatePendingReads() {
  pendingReads.clear();
}
const csrfChannel =
  typeof window === 'undefined' || typeof BroadcastChannel === 'undefined'
    ? null
    : new BroadcastChannel('abdo-erp-session');
if (csrfChannel) {
  csrfChannel.onmessage = (event: MessageEvent<unknown>) => {
    if (typeof event.data === 'string') {
      pendingReads.clear();
      clearConditionalReads();
      csrfToken = event.data;
    }
  };
}

export function rememberCsrf(token: string) {
  pendingReads.clear();
  clearConditionalReads();
  csrfToken = token;
  csrfChannel?.postMessage(token);
}

export async function request<T>(path: string, init: RequestInit = {}) {
  const method = (init.method ?? 'GET').toUpperCase();
  const mutation = method !== 'GET' && method !== 'HEAD';
  if (mutation) {
    pendingReads.clear();
    clearConditionalReads();
    try {
      const checked = duplicateAwareInput(path, init);
      try {
        return await performRequest<T>(path, checked);
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== 'DUPLICATE_SAME_WORKDAY' || typeof checked.body !== 'string') throw error;
        if (typeof window === 'undefined' || !(await confirmDuplicate()))
          throw new ApiError(409, 'DUPLICATE_CANCELLED', '');
        return await performRequest<T>(path, {
          ...checked,
          body: JSON.stringify({ ...JSON.parse(checked.body), allowDuplicate: true }),
        });
      }
    } finally {
      pendingReads.clear();
      clearConditionalReads();
    }
  }
  // Custom options (notably abort signals) must retain their independent lifecycle.
  if (method === 'GET' && Object.keys(init).length === 0 && !/^\/api\/(auth|me|health)(?:[/?]|$)/.test(path))
    return pendingReads.run(path, () => performRequest<T>(path, init));
  return performRequest<T>(path, init);
}

async function performRequest<T>(path: string, init: RequestInit) {
  const headers = new Headers(init.headers);
  const conditional=(!init.method||init.method==='GET')&&/^\/api\/notifications(?:\?|$)/.test(path);
  const generation=conditionalGeneration;
  const cached=conditional?conditionalReads.get(path):undefined;
  if(cached)headers.set('If-None-Match',cached.etag);
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
  if(response.status===304&&cached){
    if(generation!==conditionalGeneration)return performRequest<T>(path,init);
    return cached.data as T;
  }
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
  if(conditional&&generation===conditionalGeneration){const etag=response.headers.get('ETag');if(etag)conditionalReads.set(path,{etag,data:payload.data});}
  return payload.data;
}
