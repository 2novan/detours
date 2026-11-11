import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRoute } from '../src/router.js';

const start = { lat: 48.8584, lon: 2.2945 };
const end = { lat: 48.8530, lon: 2.3499 };
const pois = [
  { id: 'a', city: 'paris', category: 'monument', lat: 48.856, lon: 2.325, interest: 0.9, detourPenalty: 0.02 },
  { id: 'b', city: 'paris', category: 'nature', lat: 48.857, lon: 2.330, interest: 0.5, detourPenalty: 0.02 }
];

function mockOsrm(scaled) {
  const direct = 1000;
  return async (points) => {
    const n = points.length;
    const distance = n === 2 ? direct : direct * scaled(n);
    return {
      distance,
      duration: distance / 1.35,
      geometry: { coordinates: points.map((p) => [p.lon, p.lat]) }
    };
  };
}

test('conserve les POI quand le détour réel respecte le plafond', async () => {
  const route = await planRoute(start, end, pois, { maxDetour: 0.25 }, { osrmRoute: mockOsrm(() => 1.15) });
  assert.equal(route.pois.length, 2);
  assert.ok(route.detour <= 0.25 + 1e-9);
  assert.ok(route.geometry.length >= 2);
});

test('retire le POI le moins intéressant si le détour réel dépasse le plafond', async () => {
  const route = await planRoute(start, end, pois, { maxDetour: 0.25 }, { osrmRoute: mockOsrm((n) => (n === 2 ? 1 : n > 3 ? 1.6 : 1.2)) });
  assert.ok(route.detour <= 0.25 + 1e-9);
  assert.ok(route.pois.every((p) => p.id !== 'b'), 'le POI le moins intéressant est retiré');
});

test('retombe sur le trajet direct si aucun POI ne rentre dans le budget', async () => {
  const route = await planRoute(start, end, pois, { maxDetour: 0.1 }, { osrmRoute: mockOsrm((n) => (n === 2 ? 1 : 5)) });
  assert.equal(route.pois.length, 0);
  assert.ok(route.detour <= 0.01);
});

test('signale le meilleur POI manquant quand le plafond de détour bloque tout', async () => {
  const route = await planRoute(start, end, pois, { interest: 1, maxDetour: 0.1 }, { osrmRoute: mockOsrm((n) => (n === 2 ? 1 : 1.4)) });
  assert.equal(route.pois.length, 0);
  assert.ok(route.bestMissed, 'bestMissed est renseigné');
  assert.ok(route.bestMissed.detour > 0.1, 'le POI manqué dépasse le plafond');
});
