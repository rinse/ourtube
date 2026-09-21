import type { EventBridgeEvent } from 'aws-lambda';
import { createAppConfig } from '../config';
import { createDependencies } from '../dependencies';
import { markConversionFailed } from '../conversion/finalize';
import { parseEcsTaskEvent, type EcsTaskStateChangeDetail } from '../conversion/ecsTaskEvent';

/**
 * Conversion Lambda — the "別建て" compute, fed by a single EventBridge rule
 * ("ECS Task State Change", narrowed to the converter cluster and STOPPED).
 * It is purely a crash safety net: the Fargate task (src/task/convert.ts)
 * finalizes its own metadata on both the success and the ffmpeg-failure path,
 * so this only fires for a task that died before it could — see
 * src/conversion/ecsTaskEvent.ts.
 */
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
  // markConversionFailed's terminal-state guard makes this a no-op if the task
  // did finish and finalize before its container died.
  await markConversionFailed(deps, videoId);
}
