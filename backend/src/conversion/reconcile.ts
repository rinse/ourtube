import { MetadataStore } from '../metadata/MetadataStore';

const DEFAULT_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

export type ReconcileResult = {
  scanned: number;
  recovered: string[];
};

export async function reconcileStuckConversions(
  deps: { metadata: MetadataStore },
  options: { thresholdMs?: number; now?: Date } = {},
): Promise<ReconcileResult> {
  const thresholdMs = options.thresholdMs ?? DEFAULT_THRESHOLD_MS;
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - thresholdMs);

  const videos = await deps.metadata.list();
  const stuck = videos.filter(
    (v) => v.status === 'converting' && v.created_at < cutoff.toISOString(),
  );

  const recovered: string[] = [];
  for (const video of stuck) {
    const ok = await deps.metadata.updateStatus(video.id, 'failed');
    if (ok) {
      recovered.push(video.id);
      console.log(`[reconcile] ${video.id} stuck since ${video.created_at} → failed`);
    }
  }

  return { scanned: videos.length, recovered };
}
