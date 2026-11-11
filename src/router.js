import { buildRoute } from './engine.js';

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

  let pivots = buildRoute(start, end, pois, { ...options, maxDetour: 1 }).pois;
  while (pivots.length > 0) {
    const attempt = await route([start, ...pivots, end]);
    if (attempt.distance <= budget) {
      return finalize(attempt, direct, pivots, options);
    }
    const weakest = pivots.reduce((m, p) => (p.interest < m.interest ? p : m), pivots[0]);
    pivots = pivots.filter((p) => p !== weakest);
  }
  const fallback = await route([start, end]);
  return finalize(fallback, direct, [], options);
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
