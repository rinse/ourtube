'use client';

import { createSHA256 } from 'hash-wasm';

/**
 * Stream a (potentially multi-GB) file through SHA256 without loading it all
 * into memory. The resulting hex digest is the immutable video id and lets the
 * backend dedup before any bytes are uploaded.
 */
export async function sha256File(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const hasher = await createSHA256();
  hasher.init();

  const reader = file.stream().getReader();
  let read = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hasher.update(value);
    read += value.byteLength;
    onProgress?.(file.size > 0 ? read / file.size : 1);
  }
  return hasher.digest('hex');
}
