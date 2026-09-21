import type { EventBridgeEvent } from 'aws-lambda';
import { createAppConfig } from '../config';
import { createDependencies } from '../dependencies';
import { finalizeConversion } from '../conversion/finalize';
import { parseEcsTaskEvent, type EcsTaskStateChangeDetail } from '../conversion/ecsTaskEvent';

/**
 * Conversion Lambda — the "別建て" compute. Handles two unrelated event
 * sources, one per converter (CONVERTER=mediaconvert / CONVERTER=ecs):
 *   - MediaConvert Job State Change: the only completion signal for that
 *     converter, since MediaConvertConverter only submits the job.
 *   - ECS Task State Change: a crash safety net for EcsFfmpegConverter, whose
 *     task finalizes its own metadata on the success path (see
 *     src/conversion/ecsTaskEvent.ts).
 */
type MediaConvertDetail = {
  status: string;
  userMetadata?: { videoId?: string };
};

const deps = createDependencies(createAppConfig());

export async function handler(event: EventBridgeEvent<string, unknown>): Promise<void> {
  const detailType = event['detail-type'];
  if (detailType === 'MediaConvert Job State Change') {
    await handleMediaConvertEvent(event.detail as MediaConvertDetail);
  } else if (detailType === 'ECS Task State Change') {
    await handleEcsTaskEvent(event.detail as EcsTaskStateChangeDetail);
  } else {
    console.log(`Unhandled detail-type ${detailType}, ignoring`);
  }
}

async function handleMediaConvertEvent(detail: MediaConvertDetail): Promise<void> {
  const { status, userMetadata } = detail;
  const videoId = userMetadata?.videoId;
  if (!videoId) {
    console.error('MediaConvert event without videoId in UserMetadata; ignoring', detail);
    return;
  }
  if (status === 'COMPLETE') {
    await finalizeConversion(deps, videoId, true);
  } else if (status === 'ERROR' || status === 'CANCELED') {
    await finalizeConversion(deps, videoId, false);
  } else {
    // PROGRESSING / STATUS_UPDATE / INPUT_INFORMATION — nothing to do.
    console.log(`[${videoId}] MediaConvert status ${status}, ignoring`);
  }
}

async function handleEcsTaskEvent(detail: EcsTaskStateChangeDetail): Promise<void> {
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
  // Deliberately `finalizeConversion(..., false)`, never `true`: the success
  // path here is unreachable (a genuine success is `crashed === false` and
  // returns above), and `finalizeConversion(..., true)` also runs
  // normalizeThumbnail, which looks for MediaConvert's `thumb*.jpg` naming —
  // the Fargate task already writes the final `thumbnail.jpg` itself, so that
  // would find nothing and incorrectly flip has_thumbnail to false.
  // finalizeConversion's own terminal-state guard makes this a no-op if the
  // task actually did finish and finalize before crashing.
  await finalizeConversion(deps, videoId, false);
}
