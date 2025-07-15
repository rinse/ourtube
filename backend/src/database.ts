import sqlite3 from 'sqlite3';
import * as t from 'io-ts';
import { pipe } from 'fp-ts/function';
import { fold } from 'fp-ts/Either';
import { config } from './config';

// Create a codec that handles SQLite's 0/1 as boolean
const SQLiteBooleanCodec = new t.Type<boolean, number, unknown>(
  'SQLiteBoolean',
  (a: unknown): a is boolean => typeof a === 'boolean',
  (a: unknown, context) => {
    if (a === 0 || a === 1) {
      return t.success(Boolean(a));
    }
    if (typeof a === 'boolean') {
      return t.success(a);
    }
    return t.failure(a, context);
  },
  b => b ? 1 : 0,
);

// Define the runtime codec for VideoMetadata
export const VideoMetadataCodec = t.type({
  id: t.string,
  title: t.string,
  status: t.union([
    t.literal('converting'),
    t.literal('ready'),
    t.literal('failed')
  ]),
  created_at: t.string,
  has_thumbnail: SQLiteBooleanCodec,
});

// Extract the static type from codec
export type VideoMetadata = t.TypeOf<typeof VideoMetadataCodec>;

// Type-safe validation helper
function validateVideoMetadata(data: unknown): VideoMetadata | null {
  const result = VideoMetadataCodec.decode(data);
  return pipe(result, fold(() => null, video => video));
}

class Database {
  private db: sqlite3.Database;

  constructor(dbPath: string) {
    this.db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('Error opening database:', err);
      } else {
        console.log('Connected to SQLite database');
        this.initializeSchema();
      }
    });
  }

  private initializeSchema(): void {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS videos (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'converting',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        has_thumbnail BOOLEAN DEFAULT 0
      )
    `;

    const createIndexSQL = `
      CREATE INDEX IF NOT EXISTS idx_videos_created_at ON videos(created_at)
    `;

    this.db.run(createTableSQL, (err) => {
      if (err) {
        console.error('Error creating videos table:', err);
      } else {
        console.log('Videos table ready');
        // Create index after table is created
        this.db.run(createIndexSQL, (indexErr) => {
          if (indexErr) {
            console.error('Error creating created_at index:', indexErr);
          } else {
            console.log('Created index on created_at column');
          }
        });
      }
    });
  }

  public async getVideoMetadata(videoId: string): Promise<VideoMetadata | null> {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT * FROM videos WHERE id = ?';
      this.db.get(sql, [videoId], (err, row: unknown) => {
        if (err) {
          reject(err);
        } else {
          const videoMetadata = validateVideoMetadata(row);
          resolve(videoMetadata);
        }
      });
    });
  }

  public async listVideos(): Promise<VideoMetadata[]> {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT * FROM videos ORDER BY created_at DESC';
      this.db.all(sql, [], (err, rows: unknown[]) => {
        if (err) {
          reject(err);
        } else {
          // Validate each row and filter out invalid ones
          const validatedRows = rows
            .map(row => validateVideoMetadata(row))
            .filter((video): video is VideoMetadata => video !== null);
          resolve(validatedRows);
        }
      });
    });
  }

  public async saveVideoMetadata(metadata: VideoMetadata): Promise<void> {
    return new Promise((resolve, reject) => {
      const sql = 'INSERT OR REPLACE INTO videos (id, title, status, created_at, has_thumbnail) VALUES (?, ?, ?, ?, ?)';
      this.db.run(sql, [metadata.id, metadata.title, metadata.status, metadata.created_at, metadata.has_thumbnail], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  public async deleteVideo(videoId: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const sql = 'DELETE FROM videos WHERE id = ?';
      this.db.run(sql, [videoId], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes > 0);
        }
      });
    });
  }

  public async updateVideoTitle(videoId: string, newTitle: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const sql = 'UPDATE videos SET title = ? WHERE id = ?';
      this.db.run(sql, [newTitle, videoId], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes > 0);
        }
      });
    });
  }

  public async updateVideoThumbnailStatus(videoId: string, hasThumbnail: boolean): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const sql = 'UPDATE videos SET has_thumbnail = ? WHERE id = ?';
      this.db.run(sql, [SQLiteBooleanCodec.encode(hasThumbnail), videoId], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes > 0);
        }
      });
    });
  }

  public close(): void {
    this.db.close((err) => {
      if (err) {
        console.error('Error closing database:', err);
      } else {
        console.log('Database connection closed');
      }
    });
  }
}

// Singleton instance
export const database = new Database(config.databasePath);
