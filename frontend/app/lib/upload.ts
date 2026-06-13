'use client';

import { apiFetch } from './api';
import { sha256File } from './hash';

export type UploadPhase = 'hashing' | 'requesting' | 'uploading' | 'finalizing';

export type UploadProgress = {
  phase: UploadPhase;
  /** 0..1 within the current phase. */
  fraction: number;
};

/**
 * Full browser-driven upload: hash -> request presigned PUT (with dedup) ->
 * upload bytes straight to S3/MinIO -> tell the API to start conversion.
 */
export async function uploadVideo(
  file: File,
  title: string,
  onProgress?: (p: UploadProgress) => void,
): Promise<{ videoId: string }> {
  onProgress?.({ phase: 'hashing', fraction: 0 });
  const sha256 = await sha256File(file, (f) => onProgress?.({ phase: 'hashing', fraction: f }));

  onProgress?.({ phase: 'requesting', fraction: 0 });
  const createRes = await apiFetch('/api/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sha256,
      fileName: file.name,
      title: title || undefined,
      contentType: file.type || 'application/octet-stream',
    }),
  });
  if (createRes.status === 409) {
    throw new Error('この動画は既にアップロード済みです');
  }
  if (!createRes.ok) {
    const data = await createRes.json().catch(() => ({}));
    throw new Error(data.message || 'アップロードの開始に失敗しました');
  }
  const { videoId, uploadUrl } = await createRes.json();

  onProgress?.({ phase: 'uploading', fraction: 0 });
  await putWithProgress(uploadUrl, file, (f) => onProgress?.({ phase: 'uploading', fraction: f }));

  onProgress?.({ phase: 'finalizing', fraction: 0 });
  const completeRes = await apiFetch(`/api/uploads/${videoId}/complete`, { method: 'POST' });
  if (!completeRes.ok) {
    throw new Error('変換の開始に失敗しました');
  }
  return { videoId };
}

function putWithProgress(url: string, file: File, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    if (file.type) xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed with status ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('Upload network error'));
    xhr.send(file);
  });
}
