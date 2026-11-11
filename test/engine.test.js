import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoute, filterPois, rankPivots, CATEGORIES } from '../src/engine.js';
import { haversine } from '../src/geo.js';
import { readFileSync } from 'node:fs';

const pois = JSON.parse(readFileSync(new URL('../data/cities/paris.json', import.meta.url))).pois;
const start = { lat: 48.8584, lon: 2.2945 };
const end = { lat: 48.8530, lon: 2.3499 };

test('le trajet direct reste sous le plafond de détour', () => {
  const route = buildRoute(start, end, pois, { interest: 0.8, maxDetour: 0.25 });
  assert.ok(route.detour <= 0.25 + 1e-9, `détour ${route.detour}`);
});

test('un curseur plus « intéressant » sélectionne plus de POI', () => {
  const fast = buildRoute(start, end, pois, { interest: 0.1, maxDetour: 0.5 });
  const rich = buildRoute(start, end, pois, { interest: 1, maxDetour: 0.5 });
  assert.ok(rich.pois.length >= fast.pois.length);
  assert.ok(rich.pois.length >= 2, 'au moins 2 pivots');
  assert.ok(rich.pois.length <= 6, 'au plus 6 pivots');
});

test('les POI sélectionnés appartiennent aux catégories choisies', () => {
  const route = buildRoute(start, end, pois, { interest: 0.8, maxDetour: 0.5, categories: ['nature'] });
  assert.ok(route.pois.every((p) => p.category === 'nature'));
});

test("les POI confondus avec le départ ou l'arrivée ne sont pas pivots", () => {
  const eiffel = pois.find((p) => p.id === 'eiffel');
  const pivots = rankPivots(pois, { lat: eiffel.lat, lon: eiffel.lon }, end, { interest: 0.6, maxDetour: 1 });
  assert.ok(pivots.every((p) => p.id !== 'eiffel'), 'le POI de départ est exclu');
});

test('filterPois isole une ville', () => {
  const selected = filterPois([...pois, { id: 'x', city: 'lyon', category: 'monument', lat: 45.7, lon: 4.8, interest: 1 }], CATEGORIES, 'paris');
  assert.ok(selected.every((p) => p.city === 'paris'));
});

test('distance et durée sont cohérentes', () => {
  const route = buildRoute(start, end, pois, { interest: 0.5, maxDetour: 0.25, speed: 1.35 });
  const direct = haversine(start, end);
  assert.ok(route.distance >= direct);
  assert.ok(route.duration > 0);
  assert.ok(route.interestScore >= 0);
});

test('ordre des pivots : le parcours ne fait pas de zigzag inutile', () => {
  const route = buildRoute(start, end, pois, { interest: 0.9, maxDetour: 0.5 });
  const naive = [start, ...route.pois, end].length;
  assert.ok(naive > 0);
  const total = route.distance;
  const ordered = [start, ...route.pois.sort((a, b) => haversine(start, a) - haversine(start, b)), end]
    .reduce((s, p, i, arr) => (i ? s + haversine(arr[i - 1], p) : 0), 0);
  assert.ok(total <= ordered + 1, '2-opt au moins aussi bon que l\'ordre naïf');
});
