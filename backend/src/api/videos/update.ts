import { database } from "../../database";

export async function updateVideoTitle(videoId: string, newTitle: string): Promise<boolean> {
  const updated = await database.updateVideoTitle(videoId, newTitle);
  if (!updated) {
    return false;
  }
  return true;
}
