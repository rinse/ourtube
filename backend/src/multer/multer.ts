import multer from "multer";

export function createMulterOptions(uploadsDir: string): multer.Options {
  return {
    dest: uploadsDir,
    limits: {
      fileSize: 10 * 1024 * 1024 * 1024 // 10 GB at most
    },
    fileFilter: (req, file, callback) => {
      // Accept video files only
      if (file.mimetype.startsWith('video/')) {
        callback(null, true);
      } else {
        callback(new Error('Only video files are allowed'));
      }
    }
  };
}
