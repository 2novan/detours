import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';

const ROOT = new URL('./public/', import.meta.url).pathname;
const DATA = new URL('./data/', import.meta.url).pathname;
const SRC = new URL('./src/', import.meta.url).pathname;
const PORT = process.env.PORT || 8080;
const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml'
};

const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname === '/api/cities') {
    try {
      const citiesDir = join(DATA, 'cities');
      const files = (await readdir(citiesDir)).filter((f) => f.endsWith('.json'));
      const cities = await Promise.all(files.map(async (f) => {
        const data = JSON.parse(await readFile(join(citiesDir, f), 'utf8'));
        return { id: data.id, name: data.name, poiCount: data.pois?.length ?? 0 };
      }));
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      return res.end(JSON.stringify(cities));
    } catch (e) {
      res.writeHead(500);
      return res.end('cities error');
    }
  }
  try {
    let url = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file = join(ROOT, url === '/' ? 'index.html' : url);
    if (url.startsWith('/data/')) file = join(DATA, url.slice('/data/'.length));
    if (url.startsWith('/src/')) file = join(SRC, url.slice('/src/'.length));
    if (!file.startsWith(ROOT) && !file.startsWith(DATA) && !file.startsWith(SRC)) throw new Error('forbidden');
    try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html'); } catch {}
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`Détours: http://127.0.0.1:${PORT}`));
