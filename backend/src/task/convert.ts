import fs from 'fs';
import { createAppConfig } from '../config';
import { createDependencies } from '../dependencies';
import { LocalFfmpegConverter } from '../converter/LocalFfmpegConverter';

// ECS has no task-level timeout, so a wedged ffmpeg would bill Fargate until
// someone noticed and leave the video stuck at `converting` forever.
// ponytail: a flat cap — a legitimately slow re-encode is indistinguishable
// from a hang. Raise it if a real conversion ever trips it.
const CONVERSION_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Entrypoint for the ECS Fargate conversion task (see backend/Dockerfile).
 * Converts exactly one video (named by the VIDEO_ID env var, set as a
 * container override by EcsFfmpegConverter.startConversion) and exits.
 *
 * `run()` has its own try/catch and always leaves metadata in a terminal state
 * (`ready` or `failed`) itself, so both the success and the "ffmpeg failed"
 * cases end with exit code 0 here. A non-zero exit happens when the task dies
 * before it can finalize anything (OOM kill, uncaught crash, a hang past
 * CONVERSION_TIMEOUT_MS, ...) — that case is what the EventBridge "ECS Task
 * State Change" safety net in src/lambda/conversion.ts exists to catch.
 */
async function main(): Promise<void> {
  const videoId = process.env.VIDEO_ID;
  if (!videoId) {
    throw new Error('VIDEO_ID environment variable is required');
  }

  // Pin CONVERTER=local: this task *is* the converter, so it must never build
  // a remote one. Without the override, a task definition that inherits the API
  // Lambda's CONVERTER=ecs would make createDependencies demand the ECS_* vars
  // and kill the task before it converts anything.
  const config = createAppConfig({ ...process.env, CONVERTER: 'local' });
  const deps = createDependencies(config);

  const timer = setTimeout(() => {
    // writeSync, not console.error: a container's stderr is a pipe, and Node
    // writes to a pipe asynchronously on POSIX, so process.exit() in the same
    // tick can drop the message. This line is the only thing that tells a
    // timeout apart from an OOM kill afterwards — DynamoDB just says `failed`.
    fs.writeSync(2, `[${videoId}] Conversion timed out after ${CONVERSION_TIMEOUT_MS / 60_000} minutes, killing task\n`);
    process.exit(1);
  }, CONVERSION_TIMEOUT_MS);

  try {
    await new LocalFfmpegConverter(deps, config.tmpDir).run(videoId);
  } finally {
    clearTimeout(timer);
  }
}

main().catch((error) => {
  console.error('Conversion task crashed:', error);
  process.exit(1);
});
