import { Request, Response, NextFunction } from 'express';
import { AppConfig } from '../config';
import { signSession, verifySession, secretMatches } from './session';

export type Auth = {
  /** Express middleware that rejects unauthenticated requests (unless bypassed). */
  guard: (req: Request, res: Response, next: NextFunction) => void;
  /** POST /api/login — verifies the shared secret and sets the session cookie. */
  login: (req: Request, res: Response) => void;
  /** POST /api/logout — clears the session cookie. */
  logout: (req: Request, res: Response) => void;
};

export function createAuth(config: AppConfig): Auth {
  const { secret, bypass, cookieName, sessionTtlSeconds, cookieSecure } = config.auth;

  function setSessionCookie(res: Response): void {
    const parts = [
      `${cookieName}=${signSession(secret)}`,
      'HttpOnly',
      'Path=/',
      'SameSite=Lax',
      `Max-Age=${sessionTtlSeconds}`,
    ];
    if (cookieSecure) parts.push('Secure');
    res.append('Set-Cookie', parts.join('; '));
  }

  function isAuthenticated(req: Request): boolean {
    if (bypass) return true;
    const token = readCookie(req, cookieName);
    return verifySession(secret, token, sessionTtlSeconds);
  }

  return {
    guard(req, res, next) {
      if (isAuthenticated(req)) {
        next();
        return;
      }
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
    },

    login(req, res) {
      const provided =
        (typeof req.query.key === 'string' ? req.query.key : undefined) ??
        (typeof req.body?.secret === 'string' ? req.body.secret : undefined) ??
        '';
      if (!secretMatches(provided, secret)) {
        res.status(401).json({ error: 'Unauthorized', message: 'Invalid secret' });
        return;
      }
      setSessionCookie(res);
      res.json({ message: 'ok' });
    },

    logout(_req, res) {
      const parts = [`${cookieName}=`, 'HttpOnly', 'Path=/', 'SameSite=Lax', 'Max-Age=0'];
      if (cookieSecure) parts.push('Secure');
      res.append('Set-Cookie', parts.join('; '));
      res.json({ message: 'ok' });
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
