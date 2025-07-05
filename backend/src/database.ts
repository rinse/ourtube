import sqlite3 from 'sqlite3';
import path from 'path';

export interface VideoMetadata {
  id: string;      // SHA256 hash
  title: string;
  folder: string;  // Directory name (same as id)
  status: 'converting' | 'ready' | 'failed';
  created_at: string;
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
        folder TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'converting',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    this.db.run(createTableSQL, (err) => {
      if (err) {
        console.error('Error creating videos table:', err);
      } else {
        console.log('Videos table ready');
      }
    });
  }

  public async getVideoMetadata(videoId: string): Promise<VideoMetadata | null> {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT * FROM videos WHERE id = ?';
      this.db.get(sql, [videoId], (err, row: any) => {
        if (err) {
          reject(err);
        } else {
          resolve(row || null);
        }
      });
    });
  }

  public async listVideos(): Promise<VideoMetadata[]> {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT * FROM videos ORDER BY created_at DESC';
      this.db.all(sql, [], (err, rows: any[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  public async saveVideoMetadata(metadata: VideoMetadata): Promise<void> {
    return new Promise((resolve, reject) => {
      const sql = 'INSERT OR REPLACE INTO videos (id, title, folder, status, created_at) VALUES (?, ?, ?, ?, ?)';
      this.db.run(sql, [metadata.id, metadata.title, metadata.folder, metadata.status, metadata.created_at], (err) => {
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
const dbPath = path.join(__dirname, '..', 'videos.db');
export const database = new Database(dbPath);