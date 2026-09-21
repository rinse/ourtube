import type { EventBridgeEvent } from 'aws-lambda';
import { createAppConfig } from '../config';
import { createDependencies } from '../dependencies';
import { markConversionFailed } from '../conversion/finalize';
import { parseEcsTaskEvent, type EcsTaskStateChangeDetail } from '../conversion/ecsTaskEvent';

const deps = createDependencies(createAppConfig());

export async function handler(event: EventBridgeEvent<string, unknown>): Promise<void> {
  const detailType = event['detail-type'];
  if (detailType !== 'ECS Task State Change') {
    console.log(`Unhandled detail-type ${detailType}, ignoring`);
    return;
  }

  const detail = event.detail as EcsTaskStateChangeDetail;
  const { videoId, crashed } = parseEcsTaskEvent(detail);
  if (!crashed) {
    // Either not STOPPED yet, or the task finished and already finalized its
    // own metadata — nothing to do.
    return;
  }
  if (!videoId) {
    console.error('ECS task crashed without a VIDEO_ID override; ignoring', detail);
    return;
  }
  await markConversionFailed(deps, videoId);
}
