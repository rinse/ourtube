import crypto from 'crypto';

/**
 * Verifies the shared `*.app.esnir.net` session cookie: an ES256 JWT signed by
 * the platform auth service (app/cdk) and verifiable against its public JWKS at
 * https://auth.app.esnir.net/.well-known/jwks.json — no shared secret, no IAM.
 *
 * This is a faithful port of the platform's reference verifier
 * (platform/app/health/lambda/index.js). The non-obvious bits are contractual
 * and must not drift (see platform/knowledge/consumer-integration-contract.md):
 *   - `alg` must be hardcoded to ES256 (never branch on an attacker-chosen alg).
 *   - signature is raw IEEE-P1363 (r‖s, 64 bytes), so verify with
 *     `dsaEncoding: 'ieee-p1363'` — the Node default (DER) fails silently.
 *   - the public key is selected by `kid`; during rotation two generations are
 *     served at once, so the JWKS is cached as a Map<kid, KeyObject>.
 */

export type SessionClaims = {
  sub?: string;
  email?: string;
  exp: number;
  [key: string]: unknown;
};

const JWKS_CACHE_TTL_SECONDS = 300;

type JwksCache = { keysByKid: Map<string, crypto.KeyObject>; fetchedAt: number };
let cachedJwks: JwksCache | undefined;

async function getPublicKey(jwksUrl: string, kid: string): Promise<crypto.KeyObject | undefined> {
  const fresh = cachedJwks && Date.now() / 1000 - cachedJwks.fetchedAt < JWKS_CACHE_TTL_SECONDS;
  if (!fresh || !cachedJwks!.keysByKid.has(kid)) {
    try {
      const res = await fetch(jwksUrl);
      if (!res.ok) throw new Error(`jwks fetch failed: ${res.status}`);
      const { keys } = (await res.json()) as { keys: Array<crypto.JsonWebKey & { kid: string }> };
      const keysByKid = new Map(
        keys.map((jwk) => [jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' })]),
      );
      cachedJwks = { keysByKid, fetchedAt: Date.now() / 1000 };
    } catch (err) {
      if (cachedJwks) {
        // Serve stale cache when the JWKS endpoint is temporarily unreachable so
        // existing sessions survive a platform outage beyond the normal TTL.
        // Security trade-off: if a key was rotated due to compromise the stale
        // copy remains valid until the platform recovers — acceptable for a
        // personal app where both sides are under the same operator.
        console.warn('JWKS fetch failed, serving stale cache:', err);
      } else {
        // Cold start with no cache and JWKS unreachable: can't verify anyone.
        throw err;
      }
    }
  }
  return cachedJwks!.keysByKid.get(kid);
}

function b64urlDecode(str: string): Buffer {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** Verify the ES256 session JWT against the platform JWKS; returns claims or null. */
export async function verifySession(jwksUrl: string, jwt: string | undefined): Promise<SessionClaims | null> {
  if (!jwt) return null;
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;

  let parsedHeader: { alg?: string; kid?: string };
  try {
    parsedHeader = JSON.parse(b64urlDecode(header).toString('utf8'));
  } catch {
    return null;
  }
  // Only ever verify the one scheme we expect; never branch on an attacker-
  // controlled alg (e.g. "none") into a different, weaker verification path.
  if (parsedHeader.alg !== 'ES256' || typeof parsedHeader.kid !== 'string') return null;

  const publicKey = await getPublicKey(jwksUrl, parsedHeader.kid);
  if (!publicKey) return null; // unknown kid: rotated out, or never valid

  let signature: Buffer;
  try {
    signature = b64urlDecode(sig);
  } catch {
    return null;
  }
  const ok = crypto.verify(
    'sha256',
    Buffer.from(`${header}.${body}`),
    { key: publicKey, dsaEncoding: 'ieee-p1363' },
    signature,
  );
  if (!ok) return null;

  let claims: SessionClaims;
  try {
    claims = JSON.parse(b64urlDecode(body).toString('utf8'));
  } catch {
    return null;
  }
  if (typeof claims.exp !== 'number' || Date.now() / 1000 > claims.exp) return null;
  return claims;
}

/** Reset the module-level JWKS cache (tests only). */
export function __resetJwksCache(): void {
  cachedJwks = undefined;
}
