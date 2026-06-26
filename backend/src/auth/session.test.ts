import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import { verifySession, __resetJwksCache } from './session';

const JWKS_URL = 'https://auth.app.esnir.net/.well-known/jwks.json';
const KID = 'test-key-1';

// One EC P-256 keypair, exposed as JWKS so verifySession can fetch the public half.
const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'ES256', use: 'sig' };

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

/** Mint an ES256 session JWT the way auth.app.esnir.net does (raw IEEE-P1363 sig). */
function signSession(claims: Record<string, unknown>, kid = KID): string {
  const header = b64url(JSON.stringify({ alg: 'ES256', kid, typ: 'JWT' }));
  const body = b64url(JSON.stringify(claims));
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${body}`), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return `${header}.${body}.${b64url(sig)}`;
}

function mockJwks(keys: unknown[] = [publicJwk]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ keys }), { status: 200 })),
  );
}

const future = () => Math.floor(Date.now() / 1000) + 3600;

describe('verifySession', () => {
  beforeEach(() => {
    __resetJwksCache();
    mockJwks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts a valid ES256 session and returns its claims', async () => {
    const token = signSession({ sub: 'u1', email: 'a@b.c', exp: future() });
    const claims = await verifySession(JWKS_URL, token);
    expect(claims).toMatchObject({ sub: 'u1', email: 'a@b.c' });
  });

  it('rejects an expired token', async () => {
    const token = signSession({ sub: 'u1', exp: Math.floor(Date.now() / 1000) - 10 });
    expect(await verifySession(JWKS_URL, token)).toBeNull();
  });

  it('rejects a token whose kid is not in the JWKS', async () => {
    const token = signSession({ sub: 'u1', exp: future() }, 'unknown-kid');
    expect(await verifySession(JWKS_URL, token)).toBeNull();
  });

  it('rejects a token signed by a different key', async () => {
    const other = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const header = b64url(JSON.stringify({ alg: 'ES256', kid: KID, typ: 'JWT' }));
    const body = b64url(JSON.stringify({ sub: 'u1', exp: future() }));
    const sig = crypto.sign('sha256', Buffer.from(`${header}.${body}`), {
      key: other.privateKey,
      dsaEncoding: 'ieee-p1363',
    });
    expect(await verifySession(JWKS_URL, `${header}.${body}.${b64url(sig)}`)).toBeNull();
  });

  it('rejects alg=none (alg confusion)', async () => {
    const header = b64url(JSON.stringify({ alg: 'none', kid: KID, typ: 'JWT' }));
    const body = b64url(JSON.stringify({ sub: 'u1', exp: future() }));
    expect(await verifySession(JWKS_URL, `${header}.${body}.`)).toBeNull();
  });

  it('rejects undefined / malformed tokens', async () => {
    expect(await verifySession(JWKS_URL, undefined)).toBeNull();
    expect(await verifySession(JWKS_URL, 'no-dots')).toBeNull();
  });

  it('serves stale cache when JWKS endpoint is unreachable (platform outage)', async () => {
    // First call warms the cache.
    const token = signSession({ sub: 'u1', email: 'a@b.c', exp: future() });
    await verifySession(JWKS_URL, token);

    // Platform goes down: fetch throws.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));

    // Stale cache still accepts a valid token.
    const claims = await verifySession(JWKS_URL, token);
    expect(claims).toMatchObject({ sub: 'u1' });
  });

  it('throws (→ 500) on cold start with JWKS unreachable', async () => {
    // Cache already reset by beforeEach; fetch is broken from the start.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const token = signSession({ sub: 'u1', exp: future() });
    await expect(verifySession(JWKS_URL, token)).rejects.toThrow('ECONNREFUSED');
  });
});
