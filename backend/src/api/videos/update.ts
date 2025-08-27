import { Database } from "../../database";

export async function updateVideoTitle(deps: { database: Database }, videoId: string, newTitle: string): Promise<boolean> {
  const updated = await deps.database.updateVideoTitle(videoId, newTitle);
  if (!updated) {
    return false;
  }
  return true;
}
