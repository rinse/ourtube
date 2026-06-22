import { CreateUploadResponse } from '../api-schemas';
import { MetadataStore } from '../metadata/MetadataStore';
import { VideoMetadata } from '../metadata/VideoMetadata';
import { VideoStorage } from '../storage/VideoStorage';
import { Converter } from '../converter/Converter';
import { IllegalArgumentError } from '../utils';

const SHA256_RE = /^[0-9a-f]{64}$/;

export type CreateUploadInput = {
  sha256: string;
  fileName: string;
  title?: string;
  contentType?: string;
};

/**
 * Step 1 of the upload flow. The browser has already computed the content
 * SHA256 (which becomes the immutable video id), so we can dedup against
 * DynamoDB *before* any bytes move, then hand back a presigned PUT URL the
 * browser uploads to directly.
 *
 * Returns null when the video already exists and is not in a failed state.
 */
export async function createUpload(
  deps: { storage: VideoStorage; metadata: MetadataStore },
  input: CreateUploadInput,
): Promise<CreateUploadResponse | null> {
  const sha256 = input.sha256?.toLowerCase();
  if (!SHA256_RE.test(sha256 ?? '')) {
    throw new IllegalArgumentError('sha256 must be a 64-character hex string');
  }

  const existing = await deps.metadata.get(sha256);
  if (existing != null && existing.status !== 'failed') {
    return null; // already uploaded (ready or converting)
  }

  const title = input.title?.trim() || stripExtension(input.fileName);
  const metadata: VideoMetadata = {
    id: sha256,
    title,
    status: 'converting',
    created_at: new Date().toISOString(),
    has_thumbnail: false,
  };
  await deps.metadata.save(metadata);

  const uploadUrl = await deps.storage.presignUpload(sha256, input.contentType);
  return {
    videoId: sha256,
    title,
    status: 'converting',
    uploadUrl,
    key: deps.storage.uploadKey(sha256),
  };
}

/**
 * Step 2 of the upload flow. Called by the browser once the PUT to S3 succeeds;
 * starts conversion (local ffmpeg in dev, MediaConvert job in prod). Returns
 * false if the video record is unknown.
 *
 * Idempotent: conversion is only (re-)started while the record is still in
 * `converting`. A repeated `/complete` call (double submit, or a retry after
 * conversion already finished) must not re-trigger conversion — the source
 * file has already been deleted by then, so re-running it would only flip a
 * `ready` video to `failed`.
 */
export async function completeUpload(
  deps: { metadata: MetadataStore; converter: Converter },
  videoId: string,
): Promise<boolean> {
  const metadata = await deps.metadata.get(videoId);
  if (metadata == null) {
    return false;
  }
  if (metadata.status === 'converting') {
    const { jobId } = await deps.converter.startConversion(videoId);
    if (jobId) {
      await deps.metadata.updateConverterJobId(videoId, jobId);
    }
  }
  return true;
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^/.]+$/, '');
}
