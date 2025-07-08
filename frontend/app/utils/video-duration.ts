export async function parseHLSDuration(manifestUrl: string): Promise<number | null> {
  try {
    const response = await fetch(manifestUrl);
    if (!response.ok) {
      console.error(`Failed to fetch manifest: ${response.status}`);
      return null;
    }

    const manifest = await response.text();
    const lines = manifest.split('\n');
    
    let totalDuration = 0;
    
    for (const line of lines) {
      if (line.startsWith('#EXTINF:')) {
        // Extract duration from #EXTINF:duration,
        const durationMatch = line.match(/#EXTINF:(\d+(?:\.\d+)?),/);
        if (durationMatch) {
          totalDuration += parseFloat(durationMatch[1]);
        }
      }
    }
    
    return totalDuration > 0 ? totalDuration : null;
  } catch (error) {
    console.error('Error parsing HLS manifest:', error);
    return null;
  }
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds <= 0) {
    return '--:--';
  }
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}