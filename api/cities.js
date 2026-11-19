// Fonction serverless Vercel : GET /api/cities
// Liste les villes disponibles en lisant data/cities/*.json (inclus via vercel.json -> includeFiles).
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Résout le dossier data/cities quel que soit le cwd du runtime serverless :
// 1. relatif au cwd du process, 2. relatif au fichier de la fonction (import.meta.url).
// On prend le premier chemin qui existe.
function resolveCitiesDir() {
  const candidates = [
    join(process.cwd(), 'data', 'cities'),
    fileURLToPath(new URL('../data/cities', import.meta.url)),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return { dir, tried: candidates };
  }
  return { dir: null, tried: candidates };
}

export default async function handler(req, res) {
  try {
    const { dir, tried } = resolveCitiesDir();
    if (!dir) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-cache');
      res.status(500).end(JSON.stringify({ error: 'cities data not found', tried }));
      return;
    }
    const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
    const cities = await Promise.all(
      files.map(async (f) => {
        const data = JSON.parse(await readFile(join(dir, f), 'utf8'));
        return { id: data.id, name: data.name, poiCount: data.pois?.length ?? 0 };
      })
    );
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-cache');
    res.status(200).end(JSON.stringify(cities));
  } catch (e) {
    res.setHeader('Content-Type', 'application/json');
    res.status(500).end(JSON.stringify({ error: 'cities error' }));
  }
}
