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

/**
 * SHA256 (hex) of a small string body. Used to populate the
 * `x-amz-content-sha256` header that CloudFront's OAC SigV4 signing requires on
 * POST/PUT requests to the Lambda Function URL origin. Uses Web Crypto, which is
 * available in secure contexts (https, and localhost during dev).
 */
export async function sha256Hex(body: string): Promise<string> {
  const bytes = new TextEncoder().encode(body);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
