import { createHash } from 'node:crypto';
import { badRequest } from '../http/errors.ts';

/** Opaque hashes compare display snapshots only; financial versions remain independent. */
export function knownViewTags(value: unknown): Set<string> | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== 'string' ||
    value.length > 9000 ||
    value.split(',').length > 200 ||
    !value.split(',').every((tag) => /^[A-Za-z0-9_-]{43}$/.test(tag))
  )
    throw badRequest('INVALID_SNAPSHOT_TAGS', 'مراجع العرض غير صالحة. أعد تحميل القائمة.');
  return new Set(value.split(','));
}
export function tagViews<T extends { id: string }>(items: T[], sharedKeys: readonly string[] = []) {
  return items.map((item) => {
    const own = Object.fromEntries(Object.entries(item).filter(([key]) => !sharedKeys.includes(key)));
    return { ...item, viewTag: createHash('sha256').update(JSON.stringify(own)).digest('base64url') };
  });
}
