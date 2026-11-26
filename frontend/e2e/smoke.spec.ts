import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

// Every page renders its mocked data in a real browser without an uncaught
// error or a console error (React reports hydration and render failures
// there). Behaviour is out of scope: this catches dependency updates that
// break the app at runtime.

const video = (id: string, title: string) => ({
  id, title, status: 'ready', hlsUrl: `/api/videos/${id}/index.m3u8`, thumbnailUrl: null, duration: 61,
});
const videos = [video('v1', 'スモーク動画その一'), video('v2', 'スモーク動画その二')];
const stamp = '2026-01-01T00:00:00.000Z';
const playlist = { id: 'p1', name: 'スモークの再生リスト', created_at: stamp, updated_at: stamp };

const api: Record<string, unknown> = {
  'GET /api/videos': { videos, count: videos.length },
  'GET /api/videos/v1': videos[0],
  'GET /api/playlists': { playlists: [{ ...playlist, videoCount: 2 }], count: 1 },
  'GET /api/playlists/p1': { ...playlist, videos },
  'POST /api/playlists': { ...playlist, id: 'p2' },
  'POST /api/suggest-video-title': { suggestedTitle: '提案されたタイトル' },
  'POST /api/uploads': { videoId: 'v9', uploadUrl: 'http://localhost:3100/presigned-put' },
  'POST /api/uploads/v9/complete': {},
};

// Returns the errors seen on the page so far.
async function watch(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    // Mocks don't serve HLS media or thumbnails; those 404s are expected.
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text());
  });
  await page.route('**/api/**', (route) => {
    const req = route.request();
    const key = `${req.method()} ${new URL(req.url()).pathname}`;
    return key in api ? route.fulfill({ json: api[key] }) : route.fulfill({ status: 404, json: {} });
  });
  return errors;
}

const pages: [string, string][] = [
  ['/', 'スモーク動画その二'],
  ['/videos?id=v1', 'スモーク動画その一'],
  ['/upload', '動画をアップロード'],
  ['/playlists', 'スモークの再生リスト'],
  ['/playlists?id=p1', 'スモーク動画その二'],
];

for (const [path, text] of pages) {
  test(`${path} renders`, async ({ page }) => {
    const errors = await watch(page);
    await page.goto(path);
    await expect(page.getByText(text).first()).toBeVisible();
    expect(errors).toEqual([]);
  });
}

// Mutating requests carry a body hash computed with Web Crypto (CloudFront OAC
// needs it).
test('creating a playlist sends the body hash', async ({ page }) => {
  const errors = await watch(page);
  await page.goto('/playlists');
  await page.getByPlaceholder('プレイリスト名').fill('新しいリスト');
  const request = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/api/playlists'));
  await page.getByRole('button', { name: '作成' }).click();
  const req = await request;
  const body = req.postData() ?? '';
  expect(body).toBe(JSON.stringify({ name: '新しいリスト' }));
  expect(req.headers()['x-amz-content-sha256']).toBe(createHash('sha256').update(body).digest('hex'));
  expect(errors).toEqual([]);
});

// The file is hashed in the browser with hash-wasm (WASM) before upload; the
// digest is the video id, so a wrong one would break dedup.
test('uploading hashes the file and completes', async ({ page }) => {
  const errors = await watch(page);
  await page.route('**/presigned-put', (route) => route.fulfill({ status: 200 }));
  const bytes = Buffer.from('not really a video');
  await page.goto('/upload');
  await page.locator('#fileInput').setInputFiles({ name: 'clip.mp4', mimeType: 'video/mp4', buffer: bytes });
  const request = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/api/uploads'));
  await page.getByRole('button', { name: 'アップロード', exact: true }).click();
  const sent = JSON.parse((await request).postData() ?? '{}');
  expect(sent.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  // A fully successful upload returns to the list.
  await expect(page.getByText('スモーク動画その一').first()).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/');
  expect(errors).toEqual([]);
});
