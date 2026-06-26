import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { createApp } from '../../app';
import { createAppConfig } from '../../config';
import { Dependencies } from '../../dependencies';
import { InMemoryMetadataStore } from '../../metadata/InMemoryMetadataStore';
import { InMemoryPlaylistStore } from '../../playlist/InMemoryPlaylistStore';
import { VideoStorage } from '../../storage/VideoStorage';
import { Converter } from '../../converter/Converter';
import { GenAI } from '../../genai/GenAI';

/**
 * End-to-end routing/guard test over a real ephemeral HTTP server (no supertest
 * dependency). Proves two things the issue calls out explicitly:
 *   - every /api/playlists route returns 401 when unauthenticated;
 *   - the routes are actually wired (a smoke CRUD path under AUTH_BYPASS).
 */
function buildDeps(env: NodeJS.ProcessEnv): Dependencies {
  const config = createAppConfig(env);
  return {
    config,
    metadata: new InMemoryMetadataStore(),
    playlist: new InMemoryPlaylistStore(),
    // Unused by the playlist routes under test.
    storage: {} as unknown as VideoStorage,
    converter: {} as unknown as Converter,
    genAI: {} as unknown as GenAI,
  };
}

function listen(deps: Dependencies): Promise<{ server: Server; base: string }> {
  return new Promise((resolve) => {
    const server = createApp(deps).listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

describe('playlist routes — unauthenticated', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    // No AUTH_BYPASS → the guard is active; with no session cookie every route 401s.
    ({ server, base } = await listen(buildDeps({})));
  });
  afterAll(() => server.close());

  it.each([
    ['GET', '/api/playlists'],
    ['POST', '/api/playlists'],
    ['GET', '/api/playlists/x'],
    ['PUT', '/api/playlists/x'],
    ['DELETE', '/api/playlists/x'],
    ['POST', '/api/playlists/x/videos'],
    ['DELETE', '/api/playlists/x/videos/y'],
    ['PUT', '/api/playlists/x/videos'],
  ])('%s %s → 401', async (method, path) => {
    const res = await fetch(`${base}${path}`, { method });
    expect(res.status).toBe(401);
  });
});

describe('playlist routes — authenticated smoke CRUD', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    ({ server, base } = await listen(buildDeps({ AUTH_BYPASS: '1' })));
  });
  afterAll(() => server.close());

  it('creates, lists, renames and deletes a playlist', async () => {
    const created = await (await fetch(`${base}/api/playlists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Road Trip' }),
    })).json();
    expect(created.name).toBe('Road Trip');

    const list = await (await fetch(`${base}/api/playlists`)).json();
    expect(list.count).toBe(1);

    const rename = await fetch(`${base}/api/playlists/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    });
    expect(rename.status).toBe(200);

    const detail = await (await fetch(`${base}/api/playlists/${created.id}`)).json();
    expect(detail.name).toBe('Renamed');
    expect(detail.videos).toEqual([]);

    const del = await fetch(`${base}/api/playlists/${created.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const after = await fetch(`${base}/api/playlists/${created.id}`);
    expect(after.status).toBe(404);
  });

  it('rejects creating a playlist with a blank name (400)', async () => {
    const res = await fetch(`${base}/api/playlists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    });
    expect(res.status).toBe(400);
  });
});
