import { Request, Response, NextFunction } from 'express';
import { AppConfig } from '../config';
import { verifySession } from './session';

export type Auth = {
  /**
   * Express middleware that rejects unauthenticated requests (unless bypassed).
   * Verifies the shared `*.app.esnir.net` ES256 session cookie against the
   * platform JWKS — there is no local login; minting the cookie is the auth
   * service's job (auth.app.esnir.net). Unauthenticated callers get a 401 and
   * the SPA bounces them to the centralized login (frontend/app/lib/api.ts).
   */
  guard: (req: Request, res: Response, next: NextFunction) => void;
};

export function createAuth(config: AppConfig): Auth {
  const { bypass, cookieName, jwksUrl } = config.auth;

  return {
    async guard(req, res, next) {
      if (bypass) {
        next();
        return;
      }
      const token = readCookie(req, cookieName);
      let claims;
      try {
        claims = await verifySession(jwksUrl, token);
      } catch (err) {
        console.error('session verification failed', err);
        res.status(500).json({ error: 'Internal Server Error', message: 'Authentication check failed' });
        return;
      }
      if (claims) {
        next();
        return;
      }
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
    },
  };
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}
