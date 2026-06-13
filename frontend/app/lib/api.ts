'use client';

/**
 * Same-origin API fetch. Cookies (the session) ride along automatically.
 * On 401 we bounce to /login (preserving where we were) so the shared-secret
 * gate is transparent in production; locally AUTH_BYPASS makes this never fire.
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(path, { credentials: 'same-origin', ...init });
  if (res.status === 401 && typeof window !== 'undefined') {
    const here = window.location.pathname + window.location.search;
    if (!window.location.pathname.startsWith('/login')) {
      window.location.href = `/login?from=${encodeURIComponent(here)}`;
    }
  }
  return res;
}
