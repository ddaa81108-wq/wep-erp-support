export class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new HttpError(400, code, message, details);

export const unauthorized = () =>
  new HttpError(401, 'AUTH_REQUIRED', 'يجب تسجيل الدخول أولًا.');

export const forbidden = (permission?: string) =>
  new HttpError(403, 'PERMISSION_DENIED', 'ليست لديك صلاحية لهذه العملية.', permission ? { permission } : undefined);

export const notFound = (entity: string) =>
  new HttpError(404, 'NOT_FOUND', 'السجل المطلوب غير موجود.', { entity });

export const conflict = (code: string, message: string, details?: unknown) =>
  new HttpError(409, code, message, details);

export const payloadTooLarge = () =>
  new HttpError(413, 'REQUEST_BODY_TOO_LARGE', 'حجم الطلب أكبر من الحد المسموح.');
