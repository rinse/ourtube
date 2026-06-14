import { AppConfig } from '../../config';
import { VideoInfoResponse } from '../../api-schemas';
import { MetadataStore } from '../../metadata/MetadataStore';
import { toVideoItem } from '../videoView';

export async function getVideo(
  deps: { metadata: MetadataStore; config: AppConfig },
  videoId: string,
): Promise<VideoInfoResponse | null> {
  const video = await deps.metadata.get(videoId);
  if (video == null) {
    return null;
  }
  return toVideoItem(deps.config, video);
}
