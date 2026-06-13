import type { EventBridgeEvent } from 'aws-lambda';
import { createAppConfig } from '../config';
import { createDependencies } from '../dependencies';
import { finalizeConversion } from '../conversion/finalize';

/**
 * Conversion Lambda — the "別建て" compute. Handles MediaConvert job completion
 * events from EventBridge and finalizes the corresponding DynamoDB record.
 * (Job submission itself happens in the API Lambda via MediaConvertConverter.)
 */
type MediaConvertDetail = {
  status: string;
  userMetadata?: { videoId?: string };
};

const deps = createDependencies(createAppConfig());

export async function handler(
  event: EventBridgeEvent<'MediaConvert Job State Change', MediaConvertDetail>,
): Promise<void> {
  const { status, userMetadata } = event.detail;
  const videoId = userMetadata?.videoId;
  if (!videoId) {
    console.error('MediaConvert event without videoId in UserMetadata; ignoring', event.detail);
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
