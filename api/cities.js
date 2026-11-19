// Fonction serverless Vercel : GET /api/cities
// Liste les villes disponibles en lisant data/cities/*.json (inclus via vercel.json -> includeFiles).
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export default async function handler(req, res) {
  try {
    const dir = join(process.cwd(), 'data', 'cities');
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
    res.status(500).end(JSON.stringify({ error: 'cities error' }));
  }
}
