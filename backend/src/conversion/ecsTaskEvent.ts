export type EcsTaskStateChangeDetail = {
  lastStatus?: string;
  stoppedReason?: string;
  containers?: { name?: string; exitCode?: number }[];
  overrides?: { containerOverrides?: { name?: string; environment?: { name?: string; value?: string }[] }[] };
};

/**
 * Interprets an EventBridge "ECS Task State Change" event for a conversion
 * task. Pure function (no AWS SDK calls) so the policy is unit-testable
 * without a real ECS event — same split as buildHlsCodecArgs in
 * src/media/ffmpeg.ts.
 *
 * The conversion task (src/task/convert.ts) finalizes its own metadata before
 * exiting, so a clean run needs no action here. This only exists to catch a
 * task that died before it could do that (OOM kill, uncaught crash, ...): a
 * missing/non-zero exit code on any container is treated as a crash. A
 * `STOPPED` state with every container exiting 0 means the task already
 * finished its own bookkeeping.
 */
export function parseEcsTaskEvent(detail: EcsTaskStateChangeDetail): { videoId?: string; crashed: boolean } {
  const videoId = detail.overrides?.containerOverrides
    ?.flatMap((c) => c.environment ?? [])
    .find((e) => e.name === 'VIDEO_ID')?.value;

  if (detail.lastStatus !== 'STOPPED') {
    return { videoId, crashed: false };
  }

  const containers = detail.containers ?? [];
  // No containers, or any exit code missing/non-zero (undefined means the
  // container was killed without a chance to exit, e.g. OOM/SIGKILL).
  const crashed = containers.length === 0 || containers.some((c) => c.exitCode !== 0);
  return { videoId, crashed };
}
