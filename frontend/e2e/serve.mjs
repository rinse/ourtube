// Serves the static export like CloudFront does: /videos → videos.html.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const [root, port] = process.argv.slice(2);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' };

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  for (const p of [path, `${path}.html`, join(path, 'index.html')]) {
    try {
      const body = await readFile(join(root, p));
      res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' });
      return res.end(body);
    } catch {}
  }
  res.writeHead(404).end();
}).listen(Number(port));
