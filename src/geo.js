export const EARTH_RADIUS_M = 6371000;

const toRad = (d) => (d * Math.PI) / 180;

export function haversine(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function totalDistance(points) {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += haversine(points[i - 1], points[i]);
  return d;
}

export function interpolate(a, b, t) {
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
}

// Formate une distance en mètres pour l'affichage, en format français :
// - meters < 1000 : mètres arrondis à l'entier le plus proche, ex. 950 -> '950 m', 950.4 -> '950 m'
// - meters >= 1000 : kilomètres avec au plus 1 chiffre après la virgule et sans zéro inutile,
//   ex. 1500 -> '1,5 km', 1000 -> '1 km', 1234 -> '1,2 km', 12345 -> '12,3 km'
//   (séparateur décimal forcé à ',' manuellement, sans toLocaleString, pour un rendu identique partout)
// Cas limites documentés :
// - 0 -> '0 m' ; une entrée non numérique ou non finie (null, undefined, NaN, Infinity)
//   est traitée comme 0 -> '0 m' (évite d'afficher 'NaN m' dans l'UI)
// - une valeur négative garde son signe, ex. -1500 -> '-1,5 km' (distance signée conservée)
// - la branche m/km est choisie sur la valeur d'entrée, pas sur l'arrondi : 999.5 -> '1000 m'
export function formatDistance(meters) {
  if (typeof meters !== 'number' || !Number.isFinite(meters)) return '0 m';
  const sign = meters < 0 ? '-' : '';
  const abs = Math.abs(meters);
  if (abs < 1000) return `${sign}${Math.round(abs)} m`;
  // On travaille en dixièmes de km pour éviter tout artefact de virgule flottante :
  // ex. 12.345 km -> 123 dixièmes -> '12,3 km' (pas de toFixed/toLocaleString)
  const tenths = Math.round((abs / 1000) * 10);
  const whole = Math.floor(tenths / 10);
  const decimal = tenths % 10;
  return decimal === 0 ? `${sign}${whole} km` : `${sign}${whole},${decimal} km`;
}
