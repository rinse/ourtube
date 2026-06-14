import crypto from 'crypto';

/**
 * Stateless session token: base64url(JSON{iat}) + "." + HMAC-SHA256(secret).
 * No server-side session store — verification just recomputes the HMAC and
 * checks the issued-at against the TTL.
 */
export function signSession(secret: string, issuedAt = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ iat: issuedAt })).toString('base64url');
  const mac = hmac(secret, payload);
  return `${payload}.${mac}`;
}

export function verifySession(secret: string, token: string | undefined, ttlSeconds: number): boolean {
  if (!token) return false;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return false;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = hmac(secret, payload);
  if (!timingSafeEqual(mac, expected)) return false;
  try {
    const { iat } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (typeof iat !== 'number') return false;
    return Date.now() - iat <= ttlSeconds * 1000;
  } catch {
    return false;
  }
}

/** Constant-time comparison of the provided secret against the expected one. */
export function secretMatches(provided: string, expected: string): boolean {
  if (expected.length === 0) return false;
  return timingSafeEqual(provided, expected);
}

function hmac(secret: string, data: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
