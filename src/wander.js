import { filterPois, CATEGORIES } from './engine.js';
import { haversine } from './geo.js';
import { osrmRoute } from './router.js';


export async function planWander(start, pois, options = {}, deps = {}) {
  const route = deps.osrmRoute ?? osrmRoute;
  const speed = options.speed ?? 1.35;
  const budget = (options.duration ?? 3 * 3600) * speed;
  const eligible = filterPois(pois, options.categories ?? CATEGORIES, options.city ?? pois[0]?.city)
    .filter((p) => haversine(start, p) >= 150 && haversine(start, p) <= budget / 2);

  const nearFirst = [...eligible].sort((a, b) => haversine(start, a) - haversine(start, b) || b.interest - a.interest);
  const importantFirst = [...eligible].sort((a, b) => b.interest - a.interest || haversine(start, a) - haversine(start, b));

  const accepted = [];
  for (const poi of [...nearFirst.slice(0, 10), ...importantFirst]) {
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
    return finalize(final, accepted, options, false);
  }
  const nearest = nearFirst[0];
  if (nearest) {
    const attempt = await route([start, nearest, start]);
    return finalize(attempt, [nearest], options, attempt.distance > budget);
  }
  return {
    geometry: [start],
    pois: [],
    distance: 0,
    duration: 0,
    interestScore: 0,
    score: 0,
    loop: true,
    overBudget: false
  };
}

function finalize(route, picks, options, overBudget) {
  const speed = options.speed ?? 1.35;
  const distance = route.distance;
  const interestScore =
    picks.length === 0 ? 0 : picks.reduce((s, p) => s + p.interest, 0) / Math.max(distance / 1000, 0.5);
  return {
    geometry: route.geometry.coordinates.map(([lon, lat]) => ({ lat, lon })),
    pois: picks,
    distance,
    duration: distance / speed,
    interestScore,
    score: interestScore,
    loop: true,
    overBudget
  };
}
