import { AppConfig } from '../../config';
import { VideoListResponse } from '../../api-schemas';
import { MetadataStore } from '../../metadata/MetadataStore';
import { toVideoItem } from '../videoView';

export async function listVideos(
  deps: { metadata: MetadataStore; config: AppConfig },
): Promise<VideoListResponse> {
  const videos = await deps.metadata.list();
  const videoItems = videos.map((video) => toVideoItem(deps.config, video));
  return { videos: videoItems, count: videoItems.length };
}
