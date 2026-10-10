import { badRequest } from './errors.ts';
import { validatePasswordPolicy } from '../security/password.ts';

export function eventCursor(value: string | null) {
  if (value === null || value === '') return 0;
  const cursor = Number(value);
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    throw badRequest('INVALID_EVENT_CURSOR', 'مؤشر التحديث غير صالح.');
  }
  return cursor;
}

export function textField(value: unknown, field: string, min: number, max: number) {
  if (typeof value !== 'string') {
    throw badRequest('INVALID_FIELD', `الحقل ${field} مطلوب.`, { field });
  }
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    throw badRequest('INVALID_FIELD', `قيمة الحقل ${field} غير صالحة.`, { field });
  }
  return normalized;
}

export function secretField(value: unknown, field: string, min: number, max: number) {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    throw badRequest('INVALID_FIELD', `قيمة الحقل ${field} غير صالحة.`, { field });
  }
  return value;
}

export function newPasswordField(value: unknown, field: string) {
  const password = secretField(value, field, 10, 256);
  try {
    validatePasswordPolicy(password);
  } catch {
    throw badRequest(
      'PASSWORD_POLICY',
      'كلمة المرور يجب أن تكون بين 10 و256 محرفًا وتحتوي على حرف ورقم على الأقل.',
      { field },
    );
  }
  return password;
}
