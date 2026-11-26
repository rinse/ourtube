// Post-deploy smoke probe, run from ap-northeast-1 because CloudFront only
// admits JP viewers (geo allowlist) and GitHub-hosted runners are not in JP.
// It checks "is the site up", not behaviour: with a bogus session cookie the
// SPA must be served (200) and the API Lambda must boot and reach its auth
// middleware (401 from the Lambda, not a 403/5xx).
// Invoked by scripts/smoke.sh; returns { ok, results }.
const CHECKS = [
  ['/', 200],
  ['/api/videos', 401],
];

export async function handler() {
  const base = process.env.SITE_URL;
  const results = await Promise.all(
    CHECKS.map(async ([path, want]) => {
      try {
        const res = await fetch(base + path, {
          headers: { cookie: 'session=smoke-invalid' },
          redirect: 'manual',
          signal: AbortSignal.timeout(10_000),
        });
        return { path, want, got: res.status, ok: res.status === want };
      } catch (err) {
        return { path, want, got: String(err), ok: false };
      }
    }),
  );
  return { ok: results.every((r) => r.ok), results };
}
