/** Normalize formatting only; never infer a country or merge local/international numbers. */
export function phoneKey(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return (
    value
      .normalize('NFKC')
      .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x660))
      .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x6f0))
      .replace(/[\s()\-\u200e\u200f\u061c]/g, '') || null
  );
}
