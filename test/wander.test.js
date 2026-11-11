import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planWander } from '../src/wander.js';

const start = { lat: 48.8584, lon: 2.2945 };
const pois = [
  { id: 'a', city: 'paris', category: 'monument', lat: 48.860, lon: 2.300, interest: 0.9, detourPenalty: 0.02 },
  { id: 'b', city: 'paris', category: 'nature', lat: 48.862, lon: 2.305, interest: 0.5, detourPenalty: 0.02 },
  { id: 'c', city: 'paris', category: 'viewpoint', lat: 48.857, lon: 2.290, interest: 0.7, detourPenalty: 0.02 }
];

function mockOsrm(legMeters) {
  return async (points) => ({
    distance: legMeters * (points.length - 1),
    duration: 0,
    geometry: { coordinates: points.map((p) => [p.lon, p.lat]) }
  });
}

test('boucle dans le budget : garde les POI les plus importants', async () => {
  const route = await planWander(start, pois, { duration: 3600, speed: 1.35 }, { osrmRoute: mockOsrm(1000) });
  assert.equal(route.loop, true);
  assert.equal(route.pois.length, 3);
  assert.ok(route.distance <= 3600 * 1.35);
  assert.ok(route.duration > 0);
});

test('trop long : sacrifie les POI les moins importants jusquà rentrer', async () => {
  const route = await planWander(start, pois, { duration: 3600, speed: 1.35 }, { osrmRoute: mockOsrm(2000) });
  assert.ok(route.distance <= 3600 * 1.35, `distance ${route.distance}`);
  assert.ok(route.pois.every((p) => p.id !== 'b'), 'le POI le moins important est sacrifié');
});

test('rien ne rentre : renvoie la plus petite boucle possible avec un avertissement', async () => {
  const route = await planWander(start, pois, { duration: 600, speed: 1.35 }, { osrmRoute: mockOsrm(2000) });
  assert.equal(route.overBudget, true);
  assert.equal(route.pois.length, 1);
});

test('variantes de flânerie : une boucle par secteur géographique', async () => {
  const { planWanderVariants } = await import('../src/wander.js');
  const spread = [
    { id: 'n', city: 'paris', category: 'monument', lat: 48.872, lon: 2.2945, interest: 0.8, detourPenalty: 0.02 },
    { id: 'e', city: 'paris', category: 'nature', lat: 48.8584, lon: 2.315, interest: 0.7, detourPenalty: 0.02 },
    { id: 'w', city: 'paris', category: 'viewpoint', lat: 48.8584, lon: 2.274, interest: 0.6, detourPenalty: 0.02 }
  ];
  const variants = await planWanderVariants(start, spread, { duration: 3600, speed: 1.35 }, { osrmRoute: mockOsrm(1000) });
  assert.ok(variants.length >= 2, 'au moins deux secteurs proposés');
  assert.ok(variants.every((v) => v.label && v.loop && v.pois.length > 0));
  assert.ok(variants.some((v) => v.label === 'vers le nord'));
});
