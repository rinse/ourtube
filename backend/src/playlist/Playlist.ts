import * as t from 'io-ts';
import { pipe } from 'fp-ts/function';
import { fold } from 'fp-ts/Either';

/**
 * Domain model for a playlist: an ordered, deduplicated list of video IDs plus
 * a display name. Storage-agnostic — DynamoDB (prod) and the in-memory store
 * (tests) both produce/consume exactly this shape.
 *
 * `videoIds` is stored inline on the single playlist item (not as separate
 * member rows). At personal/single-user scale this keeps every member operation
 * a trivial array transform and makes reordering a single overwrite, well within
 * DynamoDB's 400KB item limit. Deleted videos may linger here as dangling refs;
 * they are skipped when the playlist is resolved for display (see api/playlists).
 */
export const PlaylistCodec = t.type({
  id: t.string,
  name: t.string,
  created_at: t.string,
  updated_at: t.string,
  videoIds: t.array(t.string),
});
export type Playlist = t.TypeOf<typeof PlaylistCodec>;

export function validatePlaylist(data: unknown): Playlist | null {
  return pipe(PlaylistCodec.decode(data), fold(() => null, (v) => v));
}

/** Append `videoId` to the end, deduplicating (no-op if already present). */
export function addMember(videoIds: readonly string[], videoId: string): string[] {
  return videoIds.includes(videoId) ? [...videoIds] : [...videoIds, videoId];
}

/** Remove every occurrence of `videoId`. */
export function removeMember(videoIds: readonly string[], videoId: string): string[] {
  return videoIds.filter((id) => id !== videoId);
}

/**
 * Apply a new order. `desired` is the caller's intended order and must be a
 * duplicate-free SUBSET of `current` — a subset rather than a permutation
 * because the UI only ever sees resolved (non-deleted) videos, so a playlist
 * holding a dangling ref legitimately reorders fewer IDs than it stores.
 * Returns `null` (invalid) if `desired` has duplicates or contains an ID not in
 * `current`. On success, IDs in `current` but absent from `desired` (dangling
 * refs the UI couldn't see) are preserved at the end rather than dropped.
 */
export function reorderMembers(current: readonly string[], desired: readonly string[]): string[] | null {
  if (new Set(desired).size !== desired.length) {
    return null; // duplicates
  }
  const currentSet = new Set(current);
  if (!desired.every((id) => currentSet.has(id))) {
    return null; // contains an ID not in the playlist
  }
  const desiredSet = new Set(desired);
  const remaining = current.filter((id) => !desiredSet.has(id));
  return [...desired, ...remaining];
}
