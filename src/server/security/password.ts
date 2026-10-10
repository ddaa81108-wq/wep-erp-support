import {
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';

const KEY_LENGTH = 64;
const SCRYPT = { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

export function validatePasswordPolicy(password: string) {
  if (password.length < 10) throw new Error('PASSWORD_TOO_SHORT');
  if (password.length > 256) throw new Error('PASSWORD_TOO_LONG');
  if (!/\p{L}/u.test(password) || !/\p{N}/u.test(password)) {
    throw new Error('PASSWORD_TOO_WEAK');
  }
  if (/^(.)\1+$/u.test(password)) throw new Error('PASSWORD_TOO_WEAK');
}

function derive(password: string, salt: Buffer, length: number, options: typeof SCRYPT) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, length, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string) {
  validatePasswordPolicy(password);
  const salt = randomBytes(16);
  const derived = await derive(password, salt, KEY_LENGTH, SCRYPT);
  return [
    'scrypt',
    String(SCRYPT.N),
    String(SCRYPT.r),
    String(SCRYPT.p),
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, encoded: string) {
  try {
    const [algorithm, n, r, p, saltEncoded, hashEncoded] = encoded.split('$');
    if (algorithm !== 'scrypt') return false;
    const expected = Buffer.from(hashEncoded, 'base64url');
    const cost = Number(n);
    const blockSize = Number(r);
    const parallelization = Number(p);
    if (cost !== SCRYPT.N || blockSize !== SCRYPT.r || parallelization !== SCRYPT.p || expected.length !== KEY_LENGTH) {
      return false;
    }
    const actual = await derive(
      password,
      Buffer.from(saltEncoded, 'base64url'),
      expected.length,
      {
        N: cost,
        r: blockSize,
        p: parallelization,
        maxmem: 64 * 1024 * 1024,
      },
    );
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
