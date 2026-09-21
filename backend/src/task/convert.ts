import { createAppConfig } from '../config';
import { createDependencies } from '../dependencies';
import { LocalFfmpegConverter } from '../converter/LocalFfmpegConverter';

/**
 * Entrypoint for the ECS Fargate conversion task (see backend/Dockerfile).
 * Converts exactly one video (named by the VIDEO_ID env var, set as a
 * container override by EcsFfmpegConverter.startConversion) and exits.
 *
 * `run()` has its own try/catch and always leaves metadata in a terminal state
 * (`ready` or `failed`) itself, so both the success and the "ffmpeg failed"
 * cases end with exit code 0 here. A non-zero exit only happens when the task
 * dies before it can finalize anything (OOM kill, uncaught crash, ...) — that
 * case is what the EventBridge "ECS Task State Change" safety net in
 * src/lambda/conversion.ts exists to catch.
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
  await new LocalFfmpegConverter(deps, config.tmpDir).run(videoId);
}

main().catch((error) => {
  console.error('Conversion task crashed:', error);
  process.exit(1);
});
