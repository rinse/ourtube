import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { Readable } from 'stream';
import { createApp } from '../../../app';
import { createAppConfig } from '../../../config';
import { Dependencies } from '../../../dependencies';
import { InMemoryMetadataStore } from '../../../metadata/InMemoryMetadataStore';
import { VideoStorage } from '../../../storage/VideoStorage';
import { Converter } from '../../../converter/Converter';
import { GenAI } from '../../../genai/GenAI';

const ID = 'c'.repeat(64);

/**
 * Thumbnails are served through the same /api/videos/:id/:filename route as
 * manifests/segments, but get a dedicated cache-enabled CloudFront behavior
 * (infra/lib/videoplayer-stack.ts) because they're content-addressed and
 * immutable per video id. That edge cache only helps if the origin's
 * Cache-Control says so, which this test pins down at the route handler.
 */
function buildDeps(): Dependencies {
  const config = createAppConfig({ AUTH_BYPASS: '1' });
  const metadata = new InMemoryMetadataStore();
  const storage: VideoStorage = {
    uploadKey: (id) => `uploads/${id}`,
    presignUpload: async () => 'put-url',
    getFile: async () => ({ stream: Readable.from([Buffer.from('jpeg-bytes')]), mime: 'image/jpeg' }),
    getText: async () => '',
    presignGetFile: async () => 'https://s3.test/x',
    existsFile: async () => true,
    exists: async () => true,
    delete: async () => true,
    downloadUpload: async () => {},
    deleteUpload: async () => {},
    uploadVideoDir: async () => {},
    normalizeThumbnail: async () => true,
  };
  return {
    config,
    metadata,
    playlist: {} as unknown as Dependencies['playlist'],
    storage,
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

describe('GET /api/videos/:id/thumbnail.jpg — Cache-Control', () => {
  let server: Server;
  let base: string;
  let deps: Dependencies;

  beforeAll(async () => {
    deps = buildDeps();
    await deps.metadata.save({
      id: ID, title: 't', status: 'ready', created_at: new Date().toISOString(), has_thumbnail: true,
    });
    ({ server, base } = await listen(deps));
  });
  afterAll(() => server.close());

  it('returns a long-lived, immutable Cache-Control header', async () => {
    const res = await fetch(`${base}/api/videos/${ID}/thumbnail.jpg`);
    expect(res.status).toBe(200);
    const cacheControl = res.headers.get('cache-control');
    expect(cacheControl).toContain('immutable');
    expect(cacheControl).toMatch(/max-age=\d+/);
    const maxAge = parseInt(cacheControl?.match(/max-age=(\d+)/)?.[1] ?? '0', 10);
    expect(maxAge).toBeGreaterThanOrEqual(3600);
  });
});
