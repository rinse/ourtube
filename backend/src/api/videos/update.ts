import { MetadataStore } from '../../metadata/MetadataStore';

export async function updateVideoTitle(
  deps: { metadata: MetadataStore },
  videoId: string,
  newTitle: string,
): Promise<boolean> {
  return deps.metadata.updateTitle(videoId, newTitle);
}
