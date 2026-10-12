/** Rates alone accept fractions, stored as exact millionths (up to six decimals). */
export function positiveRateMicros(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const text = String(value).trim();
  if (!/^\d{1,10}(?:\.\d{1,6})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const micros = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
  return micros > 0n && micros <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(micros) : null;
}

/** Positive whole money in/out; integer arithmetic avoids binary floating-point loss. */
export function convertedWholeUnits(
  value: number,
  rateMicros: number,
  mode: 'multiply' | 'divide',
  rounding: 'floor' | 'nearest',
): number | null {
  if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(rateMicros) || rateMicros <= 0)
    return null;
  const numerator = BigInt(value) * (mode === 'multiply' ? BigInt(rateMicros) : 1_000_000n);
  const denominator = mode === 'multiply' ? 1_000_000n : BigInt(rateMicros);
  const result = (numerator + (rounding === 'nearest' ? denominator / 2n : 0n)) / denominator;
  return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : null;
}
