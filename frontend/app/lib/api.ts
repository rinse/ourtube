'use client';

import { sha256Hex } from './hash';

const SIGNED_METHODS = new Set(['POST', 'PUT', 'PATCH']);

// Central login under the shared `*.app.esnir.net` auth. OurTube has no login
// page of its own — the edge redirects unauthenticated document loads here, and
// an expired session mid-session surfaces as a 401 we bounce on (below).
const AUTH_LOGIN_URL = 'https://auth.app.esnir.net/login';

/**
 * Same-origin API fetch. The shared `session` cookie rides along automatically.
 * On 401 we bounce to the central login (preserving where we were); locally
 * AUTH_BYPASS makes this never fire.
 *
 * For mutating methods we attach `x-amz-content-sha256` (hash of the body, or of
 * the empty string when there is none). CloudFront's OAC signs requests to the
 * Lambda Function URL with SigV4, which requires the caller to supply the body
 * hash on POST/PUT — CloudFront streams the body and won't compute it. The
 * header is harmless locally (the Express backend ignores it), so no env branch.
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  let headers = init?.headers;
  if (SIGNED_METHODS.has(method)) {
    const body = typeof init?.body === 'string' ? init.body : '';
    headers = {
      ...(headers as Record<string, string> | undefined),
      'x-amz-content-sha256': await sha256Hex(body),
    };
  }
  const res = await fetch(path, { credentials: 'same-origin', ...init, headers });
  if (res.status === 401 && typeof window !== 'undefined') {
    const returnTo = encodeURIComponent(window.location.href);
    window.location.href = `${AUTH_LOGIN_URL}?return_to=${returnTo}`;
  }
  return res;
}
