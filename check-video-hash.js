#!/usr/bin/env node

const { createHash } = require('crypto');
const fs = require('fs');
const path = require('path');

if (process.argv.length < 3) {
  console.log('Usage: node check-video-hash.js <video-file-path>');
  process.exit(1);
}

const filePath = process.argv[2];

if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

console.log(`Calculating SHA256 hash for: ${filePath}`);

const hash = createHash('sha256');
const stream = fs.createReadStream(filePath);

stream.on('data', (data) => hash.update(data));
stream.on('end', () => {
  const fileHash = hash.digest('hex');
  console.log(`\nFile: ${path.basename(filePath)}`);
  console.log(`SHA256 Hash: ${fileHash}`);
  console.log(`\nYou can check if this hash exists in the database with:`);
  console.log(`sqlite3 backend/videos.db "SELECT * FROM videos WHERE id = '${fileHash}'"`);
});
stream.on('error', (err) => {
  console.error('Error reading file:', err);
  process.exit(1);
});