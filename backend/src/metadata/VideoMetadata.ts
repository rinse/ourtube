import * as t from 'io-ts';
import { pipe } from 'fp-ts/function';
import { fold } from 'fp-ts/Either';

/**
 * Video processing status.
 * NOTE: `pending` is intentionally NOT a status — a record is created with
 * `converting` the moment the upload is presigned, so the frontend/codecs only
 * ever deal with these three values.
 */
export const VideoStatusCodec = t.union([
  t.literal('converting'),
  t.literal('ready'),
  t.literal('failed'),
]);
export type VideoStatus = t.TypeOf<typeof VideoStatusCodec>;

/**
 * Domain metadata for a single video. This is storage-agnostic: DynamoDB (prod)
 * and the in-memory store (tests) both produce/consume exactly this shape.
 *
 * `has_thumbnail` is a native boolean — unlike the old SQLite-backed store there
 * is no 0/1 coercion, because DynamoDB DocumentClient round-trips booleans.
 */
export const VideoMetadataCodec = t.intersection([
  t.type({
    id: t.string,
    title: t.string,
    status: VideoStatusCodec,
    created_at: t.string,
    has_thumbnail: t.boolean,
  }),
  t.partial({
    converter_job_id: t.string,
    duration: t.number,
  }),
]);
export type VideoMetadata = t.TypeOf<typeof VideoMetadataCodec>;

export function validateVideoMetadata(data: unknown): VideoMetadata | null {
  return pipe(VideoMetadataCodec.decode(data), fold(() => null, (v) => v));
}
