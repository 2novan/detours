import { haversine, totalDistance } from './geo.js';

const MIN_PIVOTS = 2;
const MAX_PIVOTS = 6;

export const CATEGORIES = ['monument', 'architecture', 'street_art', 'nature', 'viewpoint'];

export function filterPois(pois, categories, city) {
  if (!city) return pois;
  return pois.filter((p) => p.city === city && categories.includes(p.category));
}

function detourCost(poi, a, b) {
  const through = haversine(a, poi) + haversine(poi, b) - haversine(a, b);
  return through + poi.detourPenalty * haversine(a, b);
}

function selectPivots(pois, start, end, { interest, maxDetour }) {
  if (pois.length === 0) return [];
  const direct = haversine(start, end);
  const budget = direct * (1 + maxDetour) - direct;
  const scored = pois
    .map((p) => ({ poi: p, cost: detourCost(p, start, end), interest: p.interest }))
    .filter((s) => s.cost <= budget * 0.9)
    .sort((x, y) => y.interest / Math.max(y.cost, 1) - x.interest / Math.max(x.cost, 1));

  const picks = [];
  let used = 0;
  const targetCount = Math.max(
    MIN_PIVOTS,
    Math.round(MIN_PIVOTS + interest * (MAX_PIVOTS - MIN_PIVOTS))
  );
  for (const s of scored) {
    if (picks.length >= targetCount) break;
    if (used + s.cost > budget) continue;
    if (picks.some((p) => haversine(p, s.poi) < direct * 0.05)) continue;
    picks.push(s.poi);
    used += s.cost;
  }
  return picks;
}

function orderPivots(pivots, start, end) {
  let route = [...pivots];
  let improved = true;
  let best = routeLength(start, route, end);
  while (improved) {
    improved = false;
    for (let i = 0; i < route.length; i++) {
      for (let j = i + 1; j < route.length; j++) {
        const candidate = [...route];
        [candidate[i], candidate[j]] = [candidate[j], candidate[i]];
        const len = routeLength(start, candidate, end);
        if (len < best - 1) {
          route = candidate;
          best = len;
          improved = true;
        }
      }
    }
  }
  return route;
}

function routeLength(start, pivots, end) {
  return totalDistance([start, ...pivots, end]);
}

export function buildRoute(start, end, pois, options = {}) {
  const { interest = 0.5, maxDetour = 0.25, speed = 1.35, categories = CATEGORIES } = options;
  const eligible = filterPois(pois, categories, options.city ?? pois[0]?.city);
  const pivots = orderPivots(selectPivots(eligible, start, end, { interest, maxDetour }), start, end);
  const points = [start, ...pivots, end];
  const distance = totalDistance(points);
  const directDistance = haversine(start, end);
  const detour = directDistance > 0 ? distance / directDistance - 1 : 0;
  const interestScore =
    pivots.length === 0
      ? 0
      : pivots.reduce((s, p) => s + p.interest, 0) / Math.max(distance / 1000, 0.5);
  return {
    points,
    pois: pivots,
    distance,
    directDistance,
    detour,
    duration: distance / speed,
    interestScore,
    score: interestScore / Math.max(detour, 0.05),
  };
}
