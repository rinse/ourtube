import { GenAI } from "../genai/GenAI";
import { MetadataStore } from "../metadata/MetadataStore";
import { PlaylistStore } from "../playlist/PlaylistStore";
import { IllegalArgumentError } from "../utils";

/**
 * Titles of the other videos sharing a playlist with `videoId`, in first-seen
 * playlist-member order, self excluded, deduplicated across playlists.
 * `[]` if the video is in no playlist.
 */
export async function collectPlaylistSiblingTitles(
  deps: { playlist: PlaylistStore; metadata: MetadataStore },
  videoId: string,
): Promise<string[]> {
  const playlists = await deps.playlist.list();
  const siblingIds: string[] = [];
  const seen = new Set<string>([videoId]);
  for (const p of playlists) {
    if (!p.videoIds.includes(videoId)) {
      continue;
    }
    for (const id of p.videoIds) {
      if (!seen.has(id)) {
        seen.add(id);
        siblingIds.push(id);
      }
    }
  }
  if (siblingIds.length === 0) {
    return [];
  }
  const videos = await deps.metadata.getMany(siblingIds);
  const byId = new Map(videos.map((v) => [v.id, v]));
  return siblingIds
    .map((id) => byId.get(id)?.title)
    .filter((title): title is string => title != null);
}

export async function suggetVideoTitle(
  deps: { genAI: GenAI; playlist: PlaylistStore; metadata: MetadataStore },
  filename: string,
  videoId?: string,
): Promise<string> {
  if (filename.trim() === '') {
    throw new IllegalArgumentError('Filename cannot be empty');
  }
  const playlistTitles = videoId ? await collectPlaylistSiblingTitles(deps, videoId) : [];
  const suggestedTitle = await deps.genAI.suggestVideoTitle(filename, playlistTitles);
  if (suggestedTitle == null) {
    throw new SuggestTitleFailureError('Failed to get title suggestion');
  }
  return suggestedTitle;
}

export class SuggestTitleFailureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
