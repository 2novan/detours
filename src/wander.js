import { filterPois, CATEGORIES } from './engine.js';
import { haversine } from './geo.js';
import { osrmRoute, anchorEndpoints } from './router.js';

// ---------------------------------------------------------------------------
// Borne supérieure du nombre de POI testés comme candidats à l'insertion :
// on combine les 10 plus proches et les 12 plus intéressants, dédupliqués,
// soit au plus ~15 POI évalués (au lieu de tous les POI éligibles), pour éviter
// des centaines d'appels OSRM.
// ---------------------------------------------------------------------------
const MAX_NEAR = 10;
const MAX_IMPORTANT = 12;

function boundedCandidates(eligible, start) {
  const nearFirst = [...eligible].sort(
    (a, b) => haversine(start, a) - haversine(start, b) || b.interest - a.interest
  );
  const importantFirst = [...eligible].sort(
    (a, b) => b.interest - a.interest || haversine(start, a) - haversine(start, b)
  );
  const seen = new Set();
  const candidates = [];
  for (const p of [...nearFirst.slice(0, MAX_NEAR), ...importantFirst.slice(0, MAX_IMPORTANT)]) {
    if (seen.has(p)) continue;
    seen.add(p);
    candidates.push(p);
  }
  return { candidates, nearFirst };
}

function bearing(from, to) {
  const toRad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(to.lon - from.lon)) * Math.cos(toRad(to.lat));
  const x =
    Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat)) -
    Math.sin(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.cos(toRad(to.lon - from.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const SECTOR_LABELS = ['Vers le nord', "Vers l'est / sud-est", "Vers l'ouest / sud-ouest"];

export async function planWanderVariants(start, pois, options = {}, deps = {}) {
  const speed = options.speed ?? 1.35;
  const budget = (options.duration ?? 3 * 3600) * speed;
  const eligible = filterPois(pois, options.categories ?? CATEGORIES, options.city ?? pois[0]?.city)
    .filter((p) => haversine(start, p) >= 150 && haversine(start, p) <= budget / 2);
  const sectors = [[], [], []];
  for (const p of eligible) {
    sectors[Math.floor(((bearing(start, p) + 60) % 360) / 120)].push(p);
  }
  const variants = [];
  for (let s = 0; s < 3; s++) {
    if (sectors[s].length === 0) continue;
    const route = await planWander(start, sectors[s], options, deps);
    if (route.pois.length > 0) variants.push({ ...route, label: SECTOR_LABELS[s] });
  }
  return variants.sort((a, b) => b.pois.length - a.pois.length);
}

export async function planWander(start, pois, options = {}, deps = {}) {
  const route = deps.osrmRoute ?? osrmRoute;
  const speed = options.speed ?? 1.35;
  const budget = (options.duration ?? 3 * 3600) * speed;
  const eligible = filterPois(pois, options.categories ?? CATEGORIES, options.city ?? pois[0]?.city)
    .filter((p) => haversine(start, p) >= 150 && haversine(start, p) <= budget / 2);

  const { candidates, nearFirst } = boundedCandidates(eligible, start);

  const accepted = [];
  for (const poi of candidates) {
    if (accepted.includes(poi)) continue;
    let best = null;
    for (let pos = 0; pos <= accepted.length; pos++) {
      const waypoints = [start, ...accepted.slice(0, pos), poi, ...accepted.slice(pos), start];
      const attempt = await route(waypoints);
      if (attempt.distance <= budget && (!best || attempt.distance < best.distance)) {
        best = { distance: attempt.distance, pos, geometry: attempt.geometry };
      }
    }
    if (best) accepted.splice(best.pos, 0, poi);
  }

  if (accepted.length > 0) {
    const final = await route([start, ...accepted, start]);
    // Boucle : la géométrie commence ET finit par le départ saisi (OSRM snap
    // sinon chaque extrémité sur la route la plus proche).
    return finalize(final, accepted, options, false, start);
  }
  const nearest = nearFirst[0];
  if (nearest) {
    const attempt = await route([start, nearest, start]);
    return finalize(attempt, [nearest], options, attempt.distance > budget, start);
  }
  // Cas éligible vide : géométrie GeoJSON valide (LineString à 2 points,
  // start -> start), pas un simple [start]. Le départ saisi est déjà les deux
  // extrémités, donc rien à ancrer.
  return {
    start: { lat: Number(start.lat), lon: Number(start.lon) },
    end: { lat: Number(start.lat), lon: Number(start.lon) },
    geometry: [start, start],
    pois: [],
    distance: 0,
    duration: 0,
    interestScore: 0,
    score: 0,
    loop: true,
    overBudget: false
  };
}

function finalize(route, picks, options, overBudget, start) {
  const speed = options.speed ?? 1.35;
  const distance = route.distance;
  const interestScore =
    picks.length === 0 ? 0 : picks.reduce((s, p) => s + p.interest, 0) / Math.max(distance / 1000, 0.5);
  // Ancrage boucle : start et end sont le même point (le départ saisi), donc
  // la géométrie commence et finit par lui.
  const geometry = anchorEndpoints(
    route.geometry.coordinates.map(([lon, lat]) => ({ lat, lon })),
    start,
    start
  );
  return {
    // start = end = départ saisi (boucle) : extrémités réelles exposées pour le
    // front et l'export.
    start: { lat: Number(start.lat), lon: Number(start.lon) },
    end: { lat: Number(start.lat), lon: Number(start.lon) },
    geometry,
    pois: picks,
    distance,
    duration: distance / speed,
    interestScore,
    score: interestScore,
    loop: true,
    overBudget
  };
}
