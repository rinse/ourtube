import { describe, it, expect } from 'vitest';
import { signSession, verifySession, secretMatches } from './session';

const SECRET = 'super-secret-value';

describe('session token', () => {
  it('verifies a freshly signed token', () => {
    const token = signSession(SECRET);
    expect(verifySession(SECRET, token, 3600)).toBe(true);
  });

  it('rejects a token signed with a different secret', () => {
    const token = signSession('other-secret');
    expect(verifySession(SECRET, token, 3600)).toBe(false);
  });

  it('rejects a tampered token', () => {
    const token = signSession(SECRET);
    expect(verifySession(SECRET, `${token}x`, 3600)).toBe(false);
  });

  it('rejects an expired token', () => {
    const issuedAt = Date.now() - 10_000;
    const token = signSession(SECRET, issuedAt);
    expect(verifySession(SECRET, token, 5)).toBe(false);
  });

  it('rejects undefined / malformed tokens', () => {
    expect(verifySession(SECRET, undefined, 3600)).toBe(false);
    expect(verifySession(SECRET, 'no-dot', 3600)).toBe(false);
  });
});

describe('secretMatches', () => {
  it('matches the exact secret', () => {
    expect(secretMatches(SECRET, SECRET)).toBe(true);
  });
  it('rejects a wrong secret', () => {
    expect(secretMatches('nope', SECRET)).toBe(false);
  });
  it('never matches against an empty configured secret', () => {
    expect(secretMatches('', '')).toBe(false);
  });
});
