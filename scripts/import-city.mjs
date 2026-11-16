import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { haversine } from '../src/geo.js';

const UA = { 'User-Agent': 'Detours-prototype/1.0 (import pipeline)' };

const CATEGORY_RULES = [
  { match: (t) => t.tourism === 'attraction', category: 'monument', base: 0.85 },
  { match: (t) => t.tourism === 'museum', category: 'monument', base: 0.8 },
  { match: (t) => t.tourism === 'artwork', category: 'street_art', base: 0.6 },
  { match: (t) => t.tourism === 'viewpoint', category: 'viewpoint', base: 0.7 },
  { match: (t) => t.historic === 'monument', category: 'monument', base: 0.7 },
  { match: (t) => t.historic === 'memorial', category: 'monument', base: 0.55 },
  { match: (t) => t.historic === 'castle', category: 'monument', base: 0.75 },
  { match: (t) => t.leisure === 'park' || t.leisure === 'garden', category: 'nature', base: 0.65 }
];

const slugify = (name) =>
  name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

async function geocodeCity(name) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=fr&q=${encodeURIComponent(name)}`;
  const res = await fetch(url, { headers: UA });
  const results = await res.json();
  if (!results.length) throw new Error(`Ville introuvable sur Nominatim : ${name}`);
  const r = results[0];
  const [south, north, west, east] = r.boundingbox.map(Number);
  return { center: { lat: parseFloat(r.lat), lon: parseFloat(r.lon) }, bbox: [west, south, east, north] };
}

const SELECTORS = [
  'node[tourism=attraction][name]',
  'node[tourism=museum][name]',
  'node[tourism=artwork][name]',
  'node[tourism=viewpoint][name]',
  'node[historic=monument][name]',
  'node[historic=castle][name]',
  'way[leisure=park][name]',
  'way[leisure=garden][name]'
];

async function overpass(bbox) {
  const [w, s, e, n] = bbox;
  const bb = `${s},${w},${n},${e}`;
  const all = [];
  for (const selector of SELECTORS) {
    console.log(`  ${selector} …`);
    try {
      const elements = await overpassOnce(`[out:json][timeout:60];${selector}(${bb});out center tags;`);
      console.log(`  ${selector.padEnd(34)} ${elements.length} résultats`);
      all.push(...elements);
    } catch (err) {
      console.error(`  ${selector} : ${err.message}`);
    }
  }
  return all;
}

async function overpassOnce(query) {
  const endpoints = [
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass-api.de/api/interpreter'
  ];
  let lastError = null;
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(45000)
      });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      const data = await res.json();
      return data.elements ?? [];
    } catch (err) {
      lastError = err;
      console.error(`    ${new URL(endpoint).host} : ${err.message}`);
    }
  }
  throw lastError ?? new Error('Aucun serveur Overpass disponible');
}

function toPoi(el, cityId, center) {
  const tags = el.tags ?? {};
  const rule = CATEGORY_RULES.find((r) => r.match(tags));
  if (!rule) return null;
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) return null;
  if (haversine(center, { lat, lon }) > 8000) return null;
  let interest = rule.base;
  if (tags.wikipedia) interest += 0.15;
  if (tags.wikidata) interest += 0.05;
  if (tags.historic === 'monument' || tags.tourism === 'attraction') interest += 0.1;
  interest = Math.min(1, Math.max(0.3, interest));
  const wiki = tags.wikipedia?.startsWith('fr:')
    ? `https://fr.wikipedia.org/wiki/${encodeURIComponent(tags.wikipedia.slice(3).replace(/ /g, '_'))}`
    : null;
  return {
    id: slugify(tags.name),
    city: cityId,
    name: tags.name,
    category: rule.category,
    lat,
    lon,
    interest: Math.round(interest * 100) / 100,
    detourPenalty: 0.02,
    description: tags.description?.slice(0, 140) ?? `${rule.category === 'nature' ? 'Espace vert' : 'POI'} issue d'OpenStreetMap.`,
    wikipedia: wiki,
    image: null
  };
}

async function main() {
  const [id, name, ...rest] = process.argv.slice(2);
  if (!id || !name) {
    console.error('Usage : node scripts/import-city.mjs <id> "<Nom de la ville>" [--merge]');
    process.exit(1);
  }
  const merge = rest.includes('--merge');
  console.log(`Géocodage de « ${name} »…`);
  const { center, bbox } = await geocodeCity(name);
  console.log(`Extraction Overpass (bbox ${bbox.map((v) => v.toFixed(3)).join(', ')})…`);
  const elements = await overpass(bbox);
  console.log(`${elements.length} éléments OSM bruts`);

  const imported = [];
  const seenNames = new Set();
  for (const el of elements) {
    const poi = toPoi(el, id, center);
    if (!poi) continue;
    const key = `${poi.name.toLowerCase()}|${poi.category}`;
    if (seenNames.has(key)) continue;
    seenNames.add(key);
    imported.push(poi);
  }
  imported.sort((a, b) => b.interest - a.interest);
  const capped = imported.slice(0, 600);

  const file = new URL(`../data/cities/${id}.json`, import.meta.url);
  let output = {
    id,
    name,
    center,
    defaultZoom: 13,
    pois: capped
  };
  if (merge && existsSync(file)) {
    const existing = JSON.parse(await readFile(file, 'utf8'));
    const added = capped.filter((n) => !existing.pois.some((p) => haversine(n, p) < 150));
    output = { ...existing, pois: [...existing.pois, ...added].sort((a, b) => b.interest - a.interest) };
    console.log(`Fusion : ${existing.pois.length} POI curés conservés + ${added.length} nouveaux POI OSM`);
  } else {
    console.log(`Écriture : ${capped.length} POI`);
  }
  await writeFile(file, JSON.stringify(output, null, 2));
  console.log(`OK → data/cities/${id}.json (${output.pois.length} POI au total)`);
}

main();
