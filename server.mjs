import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, resolve, relative, sep, isAbsolute } from 'node:path';

const ROOT = new URL('./public/', import.meta.url).pathname;
const DATA = new URL('./data/', import.meta.url).pathname;
const SRC = new URL('./src/', import.meta.url).pathname;
const PORT = process.env.PORT || 8080;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

// ---------------------------------------------------------------------------
// Cache en mémoire de la liste /api/cities : on mémorise le résultat avec le
// mtime du dossier data/cities — si le dossier change (ajout/retrait/rename de
// fichier), le cache est invalidé et la liste est recalculée. Si readdir échoue,
// on invalide le cache et on retente une dernière fois (l'erreur remonte sinon).
// ---------------------------------------------------------------------------
const citiesCache = new Map(); // citiesDir -> { mtimeMs, cities }

async function readCitiesUncached(citiesDir) {
  const files = (await readdir(citiesDir)).filter((f) => f.endsWith('.json'));
  return Promise.all(files.map(async (f) => {
    const data = JSON.parse(await readFile(join(citiesDir, f), 'utf8'));
    return { id: data.id, name: data.name, poiCount: data.pois?.length ?? 0 };
  }));
}

async function listCities() {
  const citiesDir = join(DATA, 'cities');
  try {
    const dirStat = await stat(citiesDir);
    const cached = citiesCache.get(citiesDir);
    if (cached && cached.mtimeMs === dirStat.mtimeMs) return cached.cities;
    const cities = await readCitiesUncached(citiesDir);
    citiesCache.set(citiesDir, { mtimeMs: dirStat.mtimeMs, cities });
    return cities;
  } catch {
    // stat ou readdir a échoué : on invalide le cache et on recalcule
    citiesCache.delete(citiesDir);
    return readCitiesUncached(citiesDir);
  }
}

// ---------------------------------------------------------------------------
// Anti-traversée renforcé : on résout le chemin demandé contre la racine
// autorisée (public/, data/ ou src/ selon le préfixe), puis on vérifie que le
// chemin relatif résultant ne s'échappe pas : il ne doit ni commencer par '..'
// ni être absolu. /data/ et /src/ restent exposés comme avant.
// ---------------------------------------------------------------------------
function safeJoin(base, urlPath) {
  const target = resolve(base, '.' + urlPath);
  const rel = relative(base, target);
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) return null;
  return target;
}

const ALLOWED_PREFIXES = [
  { prefix: '/data/', base: DATA },
  { prefix: '/src/', base: SRC }
];

function resolveAllowed(url) {
  for (const { prefix, base } of ALLOWED_PREFIXES) {
    if (url.startsWith(prefix)) return safeJoin(base, url.slice(prefix.length - 1));
  }
  return safeJoin(ROOT, url === '/' ? '/index.html' : url);
}

const server = createServer(async (req, res) => {
  // Une seule décode, protégée par try/catch : un GET /% ne doit plus tuer le
  // processus (decodeURIComponent lève URIError sur un '%' isolé).
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Bad request');
  }

  // Seules GET et HEAD sont servies.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
    return res.end('Method Not Allowed');
  }

  if (pathname === '/api/cities') {
    try {
      const cities = await listCities();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      return res.end(JSON.stringify(cities));
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('cities error');
    }
  }

  try {
    const file = resolveAllowed(pathname);
    if (!file) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Forbidden');
    }
    let finalFile = file;
    try {
      if ((await stat(finalFile)).isDirectory()) finalFile = join(finalFile, 'index.html');
    } catch {}
    const data = await readFile(finalFile);
    res.writeHead(200, {
      'Content-Type': MIME[extname(finalFile).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    // HEAD : mêmes en-têtes, aucun corps.
    if (req.method === 'HEAD') return res.end();
    return res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Détours local  : http://127.0.0.1:${PORT}`);
  const lanIps = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  if (lanIps.length === 0) {
    console.log('Réseau local : aucune interface détectée');
  } else {
    lanIps.forEach((ip) => console.log(`Réseau local : http://${ip}:${PORT}  ← à ouvrir sur votre téléphone`));
  }
});
