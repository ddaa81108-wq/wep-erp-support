export type ApiSuccess<T> = {
  ok: true;
  data: T;
  meta?: { replayed?: boolean };
};

export type ApiFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    correlationId?: string;
  };
};

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isApiFailure(value: unknown): value is ApiFailure {
  if (!isRecord(value) || value.ok !== false || !isRecord(value.error)) return false;
  return typeof value.error.code === 'string' && typeof value.error.message === 'string';
}

export function isApiSuccess<T>(value: unknown): value is ApiSuccess<T> {
  return isRecord(value) && value.ok === true && Object.hasOwn(value, 'data');
}
