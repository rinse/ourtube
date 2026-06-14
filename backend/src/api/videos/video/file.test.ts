import { describe, it, expect } from 'vitest';
import { getVideoFile } from './file';
import { InMemoryMetadataStore } from '../../../metadata/InMemoryMetadataStore';
import { VideoStorage } from '../../../storage/VideoStorage';

const ID = 'b'.repeat(64);

const MANIFEST = `#EXTM3U
#EXT-X-VERSION:3
#EXTINF:10.0,
index_hls_00001.ts
#EXTINF:10.0,
index_hls_00002.ts
#EXT-X-ENDLIST`;

function storageWith(manifest: string): VideoStorage {
  return {
    uploadKey: (id) => `uploads/${id}`,
    presignUpload: async () => 'put-url',
    getFile: async () => { throw new Error('no'); },
    getText: async () => manifest,
    presignGetFile: async (id, file) => `https://s3.test/videos/${id}/${file}?sig=abc`,
    existsFile: async () => true,
    exists: async () => true,
    delete: async () => true,
    downloadUpload: async () => {},
    deleteUpload: async () => {},
    uploadVideoDir: async () => {},
    normalizeThumbnail: async () => false,
  };
}

async function readyVideo(): Promise<InMemoryMetadataStore> {
  const metadata = new InMemoryMetadataStore();
  await metadata.save({ id: ID, title: 't', status: 'ready', created_at: new Date().toISOString(), has_thumbnail: true });
  return metadata;
}

describe('getVideoFile manifest handling', () => {
  it('serves the manifest verbatim with segment lines left relative (no presigned URLs)', async () => {
    const metadata = await readyVideo();
    const file = await getVideoFile({ storage: storageWith(MANIFEST), metadata }, ID, 'index.m3u8');
    expect(file?.status).toBe('ready');
    if (file?.status === 'ready' && file.kind === 'manifest') {
      // Comments preserved and segment lines stay relative so the browser
      // re-requests each through the API (presigned at request time).
      expect(file.body).toContain('#EXTINF:10.0,');
      expect(file.body).toContain('index_hls_00001.ts');
      expect(file.body).toContain('index_hls_00002.ts');
      // No presigned URL must leak into the manifest body.
      expect(file.body).not.toContain('https://s3.test/');
      expect(file.body).toBe(MANIFEST);
    } else {
      throw new Error('expected manifest');
    }
  });

  it('redirects a direct segment request to a freshly presigned URL', async () => {
    const metadata = await readyVideo();
    const file = await getVideoFile({ storage: storageWith(MANIFEST), metadata }, ID, 'index_hls_00001.ts');
    expect(file?.status === 'ready' && file.kind === 'redirect').toBe(true);
  });

  it('reports converting status without touching storage', async () => {
    const metadata = new InMemoryMetadataStore();
    await metadata.save({ id: ID, title: 't', status: 'converting', created_at: new Date().toISOString(), has_thumbnail: false });
    const file = await getVideoFile({ storage: storageWith(MANIFEST), metadata }, ID, 'index.m3u8');
    expect(file?.status).toBe('converting');
  });

  it('rejects disallowed filenames', async () => {
    const metadata = await readyVideo();
    await expect(getVideoFile({ storage: storageWith(MANIFEST), metadata }, ID, 'secret.txt'))
      .rejects.toThrow(/Invalid file type/);
  });
});
