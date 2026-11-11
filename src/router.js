import { rankPivots } from './engine.js';

const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';

export async function osrmRoute(points, signal) {
  const coords = points.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const res = await fetch(`${OSRM_BASE}/${coords}?overview=full&geometries=geojson`, { signal });
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes?.length) throw new Error(data.message || 'OSRM: pas de route');
  return data.routes[0];
}

export async function planRoute(start, end, pois, options = {}, deps = {}) {
  const route = deps.osrmRoute ?? osrmRoute;
  const direct = await route([start, end]);
  const budget = direct.distance * (1 + (options.maxDetour ?? 0.25));

  const candidates = rankPivots(pois, start, end, options).slice(0, 6);
  const minEfficiency = 3 - 2.5 * (options.interest ?? 0.5);
  const accepted = [];
  let currentDistance = direct.distance;
  for (const poi of candidates) {
    let best = null;
    for (let pos = 0; pos <= accepted.length; pos++) {
      const waypoints = [start, ...accepted.slice(0, pos), poi, ...accepted.slice(pos), end];
      const attempt = await route(waypoints);
      if (attempt.distance <= budget && (!best || attempt.distance < best.distance)) {
        best = { distance: attempt.distance, pos, geometry: attempt.geometry };
      }
    }
    if (!best) continue;
    const added = best.distance - currentDistance;
    const efficiency = (poi.interest / Math.max(added, 1)) * 1000;
    if (added > 0 && efficiency < minEfficiency) continue;
    accepted.splice(best.pos, 0, poi);
    currentDistance = best.distance;
  }
  const final = accepted.length > 0 ? await route([start, ...accepted, end]) : direct;
  return finalize(final, direct, accepted, options);
}

function finalize(route, direct, pivots, options) {
  const distance = route.distance;
  const detour = direct.distance > 0 ? distance / direct.distance - 1 : 0;
  const speed = options.speed ?? 1.35;
  const interestScore =
    pivots.length === 0 ? 0 : pivots.reduce((s, p) => s + p.interest, 0) / Math.max(distance / 1000, 0.5);
  return {
    geometry: route.geometry.coordinates.map(([lon, lat]) => ({ lat, lon })),
    pois: pivots,
    distance,
    directDistance: direct.distance,
    detour,
    duration: distance / speed,
    interestScore,
    score: interestScore / Math.max(detour, 0.05)
  };
}
