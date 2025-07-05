import { database } from './database';

async function migrateSampleVideo() {
  const videoId = 'fa7014331597dba179a75a3ddf0dcaf0fd4f989faaa82957ef2c824743097d2b';
  const videoMetadata = {
    id: videoId,
    title: 'サンプル動画',
    folder: videoId,
    status: 'ready' as const,
    created_at: new Date().toISOString()
  };

  try {
    await database.saveVideoMetadata(videoMetadata);
    console.log('Sample video migrated successfully:');
    console.log('- Video ID:', videoId);
    console.log('- Title:', videoMetadata.title);
    console.log('- Folder:', videoMetadata.folder);
    
    // Verify the record was saved
    const savedVideo = await database.getVideoMetadata(videoId);
    if (savedVideo) {
      console.log('✅ Migration verified successfully');
    } else {
      console.log('❌ Migration verification failed');
    }
  } catch (error) {
    console.error('Migration failed:', error);
  }
}

migrateSampleVideo();