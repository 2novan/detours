import { rankPivots, filterPois, CATEGORIES } from './engine.js';

const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';
const OSRM_TIMEOUT_MS = 8000; // plafond par tentative
const OSRM_MAX_RETRIES = 2;   // nombre de retries après la 1ʳᵉ tentative

// ---------------------------------------------------------------------------
// fetch borné dans le temps : chaque appel OSRM est annulé s'il dépasse ms
// (AbortController.timeout si disponible, sinon setTimeout + abort manuel).
// ---------------------------------------------------------------------------
export function fetchWithTimeout(url, signal, ms = OSRM_TIMEOUT_MS) {
  if (typeof AbortController !== 'undefined' && typeof AbortController.timeout === 'function') {
    return fetch(url, { signal: AbortSignal.any ? AbortSignal.any([signal, AbortController.timeout(ms)].filter(Boolean)) : (signal ?? AbortController.timeout(ms)) });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  return fetch(url, { signal: controller.signal }).finally(() => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// osrmRoute : appel OSRM avec timeout + retry (max 2) et backoff exponentiel
// sur 429 et 5xx. Le signal appelant est propagé à chaque tentative.
// ---------------------------------------------------------------------------
export async function osrmRoute(points, signal) {
  const coords = points.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const url = `${OSRM_BASE}/${coords}?overview=full&geometries=geojson`;
  let lastError;
  for (let attempt = 0; attempt <= OSRM_MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(250 * 2 ** (attempt - 1)); // 250 ms, 500 ms
    let res;
    try {
      res = await fetchWithTimeout(url, signal, OSRM_TIMEOUT_MS);
    } catch (err) {
      // Timeout/abort réseau : on retry aussi (transitoire), sauf si le caller a annulé.
      if (signal?.aborted) throw err;
      lastError = err;
      continue;
    }
    if (res.ok) {
      const data = await res.json();
      if (data.code !== 'Ok' || !data.routes?.length) throw new Error(data.message || 'OSRM: pas de route');
      return data.routes[0];
    }
    // Retry uniquement sur 429 (rate limit) et 5xx (indisponibilité serveur).
    if (res.status !== 429 && !(res.status >= 500 && res.status < 600)) {
      throw new Error(`OSRM ${res.status}`);
    }
    lastError = new Error(`OSRM ${res.status}`);
  }
  throw lastError;
}

export async function planRoute(start, end, pois, options = {}, deps = {}) {
  const route = deps.osrmRoute ?? osrmRoute;
  // On filtre les POI en tête : catégories toujours appliquées, ville seulement
  // si fournie — un POI hors catégorie ne doit jamais être proposé.
  const eligible = filterPois(pois, options.categories ?? CATEGORIES, options.city);
  const direct = await route([start, end]);
  const budget = direct.distance * (1 + (options.maxDetour ?? 0.25));

  const candidates = rankPivots(eligible, start, end, options).slice(0, 6);
  const minEfficiency = (1 - (options.interest ?? 0.5)) * 1.2;
  const solo = [];
  for (const poi of candidates) {
    const attempt = await route([start, poi, end]);
    solo.push({ poi, added: attempt.distance - direct.distance });
  }
  solo.sort((a, b) => a.added - b.added);
  const accepted = [];
  const rejected = [];
  for (const { poi, added } of solo) {
    const efficiency = (poi.interest / Math.max(added, 1)) * 1000;
    if (added > 0 && efficiency < minEfficiency) continue;
    let best = null;
    for (let pos = 0; pos <= accepted.length; pos++) {
      const waypoints = [start, ...accepted.slice(0, pos), poi, ...accepted.slice(pos), end];
      const attempt = await route(waypoints);
      if (attempt.distance <= budget && (!best || attempt.distance < best.distance)) {
        best = { distance: attempt.distance, pos, geometry: attempt.geometry };
      }
    }
    if (best) accepted.splice(best.pos, 0, poi);
    else rejected.push({ poi, added });
  }
  const final = accepted.length > 0 ? await route([start, ...accepted, end]) : direct;
  const result = finalize(final, direct, accepted, options);
  if (accepted.length === 0 && rejected.length > 0) {
    const cheapest = rejected.sort((a, b) => a.added - b.added)[0];
    result.bestMissed = {
      poi: cheapest.poi,
      detour: cheapest.added / Math.max(direct.distance, 1)
    };
  }
  return result;
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
