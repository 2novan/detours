import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchorEndpoints, planRoute } from '../src/router.js';
import { planWander, planWanderVariants } from '../src/wander.js';
import { gmapsUrl, appleMapsUrl, buildGpx } from '../src/export.js';

// ---------------------------------------------------------------------------
// Fixtures : points SAISIS par l'utilisateur (ceux que l'itinéraire doit
// commencer/terminer), et un mock OSRM qui « snappe » chaque waypoint à ~100 m
// (0.001 degré ≈ 111 m), comme le vrai OSRM qui projette sur la route la plus
// proche — la géométrie renvoyée ne contient alors plus les points saisis.
// ---------------------------------------------------------------------------
const START = { lat: 48.8584, lon: 2.2945 }; // départ saisi (Tour Eiffel)
const END = { lat: 48.853, lon: 2.3499 };    // arrivée saisie
const POIS = [
  { id: 'a', city: 'paris', category: 'monument', lat: 48.856, lon: 2.325, interest: 0.9, detourPenalty: 0.02 },
  { id: 'b', city: 'paris', category: 'nature', lat: 48.857, lon: 2.33, interest: 0.5, detourPenalty: 0.02 }
];

const SNAP_DEG = 0.001; // ~100 m : décalage appliqué par le mock OSRM (snap)
const START_SNAPPED = { lat: START.lat + SNAP_DEG, lon: START.lon + SNAP_DEG };
const END_SNAPPED = { lat: END.lat + SNAP_DEG, lon: END.lon + SNAP_DEG };

/** Mock OSRM qui snappe la géométrie : chaque waypoint est décalé de ~100 m. */
function snappedOsrm(distanceFor) {
  return async (points) => {
    const n = points.length;
    const distance = distanceFor ? distanceFor(n) : 1000 * (n - 1);
    return {
      distance,
      duration: distance / 1.35,
      geometry: { coordinates: points.map((p) => [p.lon + SNAP_DEG, p.lat + SNAP_DEG]) }
    };
  };
}

// ===========================================================================
// 1. anchorEndpoints(geometry, start, end) — unité
// ===========================================================================

test('anchorEndpoints : géométrie vide -> [start, end]', () => {
  const out = anchorEndpoints([], START, END);
  assert.deepEqual(out, [START, END]);
  assert.equal(out.length, 2);
});

test('anchorEndpoints : start identique au 1er point -> pas de doublon en tête', () => {
  const geometry = [START, { lat: 48.86, lon: 2.32 }, END];
  const out = anchorEndpoints(geometry, START, END);
  assert.equal(out.length, 3, 'aucun point ajouté');
  assert.deepEqual(out[0], START);
  assert.deepEqual(out.at(-1), END);
});

test('anchorEndpoints : start différent du 1er point -> préfixé', () => {
  const a = { lat: 48.86, lon: 2.32 };
  const b = { lat: 48.855, lon: 2.34 };
  const out = anchorEndpoints([a, b], START, b);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], START, 'le départ saisi est préfixé');
  assert.deepEqual(out[1], a);
  assert.deepEqual(out.at(-1), b);
});

test('anchorEndpoints : end différent du dernier point -> suffixé', () => {
  const a = { lat: 48.86, lon: 2.32 };
  const out = anchorEndpoints([START, a], START, END);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], START);
  assert.deepEqual(out.at(-1), END, "l'arrivée saisie est suffixée");
});

test('anchorEndpoints : boucle start == end -> préfixe ET suffixe (départ des deux côtés)', () => {
  const a = { lat: 48.86, lon: 2.32 };
  const b = { lat: 48.862, lon: 2.31 };
  const out = anchorEndpoints([a, b], START, START);
  assert.equal(out.length, 4);
  assert.deepEqual(out[0], START, 'commence par le départ saisi');
  assert.deepEqual(out.at(-1), START, 'finit par le départ saisi (boucle)');
});

test('anchorEndpoints : boucle avec géométrie commençant déjà par start -> pas de doublon en tête, suffixe en fin', () => {
  const a = { lat: 48.86, lon: 2.32 };
  const out = anchorEndpoints([START, a], START, START);
  assert.equal(out.length, 3, 'pas de doublon au début');
  assert.deepEqual(out[0], START);
  assert.deepEqual(out.at(-1), START, 'suffixe ajouté car le dernier point diffère');
});

test('anchorEndpoints : lat/lon en strings -> normalisés en numbers', () => {
  const out = anchorEndpoints([], { lat: '48.8584', lon: '2.2945' }, { lat: '48.853', lon: '2.3499' });
  assert.equal(typeof out[0].lat, 'number');
  assert.equal(typeof out[0].lon, 'number');
  assert.deepEqual(out, [START, END]);
});

test('anchorEndpoints : ne mute pas le tableau d\'entrée', () => {
  const a = { lat: 48.86, lon: 2.32 };
  const b = { lat: 48.855, lon: 2.34 };
  const input = [a, b];
  const snapshot = [...input];
  const out = anchorEndpoints(input, START, END);
  assert.deepEqual(input, snapshot, "le tableau d'entrée est inchangé");
  assert.equal(input.length, 2);
  assert.notEqual(out, input, 'une nouvelle géométrie est produite quand on ancre');
  assert.deepEqual(out.slice(1, -1), [a, b], 'les points d\'origine sont conservés au milieu');
});

test('anchorEndpoints : epsilon 1e-6 deg — à 5e-7 pas de doublon, à 1e-5 préfixe ajouté', () => {
  const a = { lat: 48.86, lon: 2.32 };
  const b = { lat: 48.855, lon: 2.34 };
  // écart 5e-7 <= EPSILON_DEG (1e-6) : considéré comme identique, pas de doublon
  const near = { lat: a.lat + 5e-7, lon: a.lon + 5e-7 };
  const outNear = anchorEndpoints([a, b], near, b);
  assert.equal(outNear.length, 2, 'pas de doublon sous le seuil epsilon');
  // écart 1e-5 > EPSILON_DEG : point différent, préfixé
  const far = { lat: a.lat + 1e-5, lon: a.lon + 1e-5 };
  const outFar = anchorEndpoints([a, b], far, b);
  assert.equal(outFar.length, 3, 'au-delà d\'epsilon le point est préfixé');
  assert.deepEqual(outFar[0], far);
});

// ===========================================================================
// 2. planRoute avec mock OSRM snappé : géométrie ancrée + start/end exposés
// ===========================================================================

test('planRoute (POI acceptés) : geometry[0] === départ saisi, geometry.at(-1) === arrivée saisie, start/end exposés', async () => {
  const route = await planRoute(START, END, POIS, { maxDetour: 0.25 }, { osrmRoute: snappedOsrm((n) => (n === 2 ? 1000 : 1150)) });
  assert.ok(route.pois.length >= 1, 'au moins un POI accepté (chemin avec détour)');
  assert.deepEqual(route.geometry[0], START, 'la géométrie commence par le départ SAISI, pas par le point snappé');
  assert.deepEqual(route.geometry.at(-1), END, "la géométrie finit par l'arrivée SAISIE");
  // le point OSRM snappé du départ reste en 2e position : l'ancrage ajoute le
  // point saisi SANS supprimer le point snappé (la géométrie OSRM est conservée)
  assert.deepEqual(route.geometry[1], START_SNAPPED, 'le 2e point est le départ snappé par OSRM (~100 m)');
  assert.deepEqual(route.start, START, 'result.start exposé');
  assert.deepEqual(route.end, END, 'result.end exposé');
  assert.equal(typeof route.start.lat, 'number');
});

test('planRoute (aucun POI accepté, retombée sur direct) : géométrie quand même ancrée sur start/end saisis', async () => {
  // détour de 5x le direct pour tout POI -> rien n'est accepté -> final = direct (géométrie snappée)
  const route = await planRoute(START, END, POIS, { maxDetour: 0.1 }, { osrmRoute: snappedOsrm((n) => (n === 2 ? 1000 : 5000)) });
  assert.equal(route.pois.length, 0, 'retombée sur le trajet direct');
  assert.deepEqual(route.geometry[0], START, 'geometry[0] = départ saisi même en retombée direct');
  assert.deepEqual(route.geometry.at(-1), END, 'geometry.at(-1) = arrivée saisie même en retombée direct');
  assert.deepEqual(route.start, START);
  assert.deepEqual(route.end, END);
});

// ===========================================================================
// 3. planWander avec mock OSRM snappé : boucle ancrée des DEUX côtés
// ===========================================================================

test('planWander : geometry[0] === départ ET geometry.at(-1) === départ, start === end === départ', async () => {
  const route = await planWander(START, POIS, { duration: 3600, speed: 1.35 }, { osrmRoute: snappedOsrm() });
  assert.equal(route.loop, true);
  assert.ok(route.pois.length >= 1, 'au moins un POI dans la boucle');
  assert.deepEqual(route.geometry[0], START, 'boucle ancrée en tête : départ saisi');
  assert.deepEqual(route.geometry.at(-1), START, 'boucle ancrée en fin : retour au départ saisi');
  assert.deepEqual(route.start, START, 'result.start = départ saisi');
  assert.deepEqual(route.end, START, 'result.end = départ saisi (boucle)');
});

// ===========================================================================
// 4. planWanderVariants : chaque variante a start/end et une géométrie ancrée
// ===========================================================================

test('planWanderVariants : chaque variante expose start/end et ancre sa géométrie des deux côtés', async () => {
  const spread = [
    { id: 'n', city: 'paris', category: 'monument', lat: 48.872, lon: 2.2945, interest: 0.8, detourPenalty: 0.02 },
    { id: 'e', city: 'paris', category: 'nature', lat: 48.8584, lon: 2.315, interest: 0.7, detourPenalty: 0.02 },
    { id: 'w', city: 'paris', category: 'viewpoint', lat: 48.8584, lon: 2.274, interest: 0.6, detourPenalty: 0.02 }
  ];
  const variants = await planWanderVariants(START, spread, { duration: 3600, speed: 1.35 }, { osrmRoute: snappedOsrm() });
  assert.ok(variants.length >= 2, 'plusieurs variantes proposées');
  for (const v of variants) {
    assert.deepEqual(v.start, START, `variante ${v.label} : start = départ saisi`);
    assert.deepEqual(v.end, START, `variante ${v.label} : end = départ saisi (boucle)`);
    assert.deepEqual(v.geometry[0], START, `variante ${v.label} : geometry ancrée en tête`);
    assert.deepEqual(v.geometry.at(-1), START, `variante ${v.label} : geometry ancrée en fin`);
  }
});

// ===========================================================================
// 5. export : endpoints() lit route.start/route.end en priorité
// ===========================================================================

// Route telle que produite par planRoute avec OSRM snappé : start/end = points
// saisis, geometry = points snappés (~100 m plus loin).
const snappedRoute = {
  start: START,
  end: END,
  loop: false,
  distance: 4200,
  duration: 3600,
  geometry: [START_SNAPPED, { lat: 48.86, lon: 2.32 }, END_SNAPPED],
  pois: []
};

test('gmapsUrl : origin = vrai départ saisi (route.start), pas geometry[0] snappé', () => {
  const url = gmapsUrl(snappedRoute);
  assert.ok(url.includes('origin=48.858400,2.294500'), `origin = départ saisi, reçu ${url}`);
  assert.ok(!url.includes('48.859400'), 'le point snappé ne fuite pas dans l\'URL');
  assert.ok(url.includes('destination=48.853000,2.349900'), 'destination = arrivée saisie (route.end)');
});

test('appleMapsUrl : saddr = vrai départ saisi (route.start), pas geometry[0] snappé', () => {
  const url = appleMapsUrl(snappedRoute);
  assert.ok(url.includes('saddr=48.858400,2.294500'), `saddr = départ saisi, reçu ${url}`);
  assert.ok(!url.includes('48.859400'), 'le point snappé ne fuite pas dans l\'URL');
  assert.ok(url.includes('daddr=48.853000,2.349900'), 'daddr = arrivée saisie');
});

test('export boucle (loop: true) : destination = départ saisi (start), pas geometry[0]', () => {
  const loopRoute = {
    start: START,
    end: START,
    loop: true,
    distance: 2000,
    duration: 1500,
    geometry: [START_SNAPPED, { lat: 48.86, lon: 2.32 }, START_SNAPPED],
    pois: []
  };
  const g = gmapsUrl(loopRoute);
  assert.ok(g.includes('origin=48.858400,2.294500'), `origine = départ saisi, reçu ${g}`);
  assert.ok(g.includes('destination=48.858400,2.294500'), `boucle : destination = départ saisi, reçu ${g}`);
  assert.ok(!g.includes('48.859400'), 'point snappé absent de l\'URL');
  const a = appleMapsUrl(loopRoute);
  assert.equal(a.match(/saddr=([^&]*)/)[1], '48.858400,2.294500');
  assert.equal(a.match(/daddr=([^&]*)/)[1], '48.858400,2.294500', 'boucle apple : saddr == daddr == départ saisi');
});

test('buildGpx : 1er rtept = départ saisi (chaîne complète planRoute snappé -> GPX)', async () => {
  const route = await planRoute(START, END, POIS, { maxDetour: 0.25 }, { osrmRoute: snappedOsrm((n) => (n === 2 ? 1000 : 1150)) });
  const gpx = buildGpx(route);
  const rte = gpx.match(/<rte>[\s\S]*?<\/rte>/)[0];
  const rtepts = [...rte.matchAll(/<rtept lat="([^"]+)" lon="([^"]+)"/g)];
  assert.ok(rtepts.length >= 2);
  assert.equal(rtepts[0][1], START.lat.toFixed(6), '1er rtept lat = départ saisi');
  assert.equal(rtepts[0][2], START.lon.toFixed(6), '1er rtept lon = départ saisi');
  assert.equal(rtepts.at(-1)[1], END.lat.toFixed(6), 'dernier rtept lat = arrivée saisie');
  assert.equal(rtepts.at(-1)[2], END.lon.toFixed(6), 'dernier rtept lon = arrivée saisie');
  // le point snappé peut apparaître en position intermédiaire, mais JAMAIS aux extrémités
  assert.notEqual(rtepts[0][1], START_SNAPPED.lat.toFixed(6), 'l\'extrémité de tête n\'est pas le point snappé');
  assert.notEqual(rtepts.at(-1)[1], END_SNAPPED.lat.toFixed(6), 'l\'extrémité de fin n\'est pas le point snappé');
});

test('buildGpx : route avec start/end et geometry ancrée -> 1er rtept = départ saisi', () => {
  const gpx = buildGpx({
    start: START,
    end: END,
    geometry: [START, { lat: 48.86, lon: 2.32 }, END],
    pois: []
  });
  const first = gpx.match(/<rtept lat="([^"]+)" lon="([^"]+)"/);
  assert.equal(first[1], '48.858400');
  assert.equal(first[2], '2.294500');
});

test('export fallback legacy : route SANS start/end -> origin/saddr = geometry[0] (comportement historique)', () => {
  const legacy = { geometry: [START_SNAPPED, END_SNAPPED], pois: [] };
  const g = gmapsUrl(legacy);
  assert.ok(g.includes('origin=48.859400,2.295500'), `sans start/end, repli sur geometry[0], reçu ${g}`);
  assert.ok(g.includes('destination=48.854000,2.350900'), 'repli sur geometry.at(-1)');
  const a = appleMapsUrl(legacy);
  assert.ok(a.includes('saddr=48.859400,2.295500'), 'apple : repli sur geometry[0]');
  assert.ok(a.includes('daddr=48.854000,2.350900'), 'apple : repli sur geometry.at(-1)');
});
