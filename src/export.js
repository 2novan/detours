// Export multi-applis des itinéraires calculés par Détours : Google Maps, Apple Plans,
// Waze, URI geo: (Android) et fichier GPX 1.1 universel (Strava, Garmin, OsmAnd, Komoot, QGIS…).
// Module ES pur, sans aucune dépendance navigateur : testable directement sous Node.

const TRAVEL_MODES = ['walking', 'bicycling', 'driving'];

const TRAVEL_MODE_LABELS = {
  walking: 'à pied',
  bicycling: 'à vélo',
  driving: 'en voiture'
};

/** travelMode accepté : 'walking' | 'bicycling' | 'driving' — défaut 'walking'. */
function normalizeTravelMode(mode) {
  return TRAVEL_MODES.includes(mode) ? mode : 'walking';
}

/** Coordonnée formatée (6 décimales, précision ~10 cm) : que des caractères sûrs dans une URL. */
function fmtCoord(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(6) : null;
}

/** "lat,lon" prêt pour une query string (chiffres, '.', '-', ',' uniquement). */
function ll(p) {
  const lat = fmtCoord(p?.lat);
  const lon = fmtCoord(p?.lon);
  return lat === null || lon === null ? null : `${lat},${lon}`;
}

/**
 * Échappement XML strict des 5 caractères réservés — utilisé pour le texte
 * comme pour les attributs, sans exception.
 */
export function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Extrémités de l'itinéraire : départ = premier point de la géométrie,
 * arrivée = dernier point (le départ lui-même pour une boucle, route.loop === true).
 */
function endpoints(route) {
  const pts = (Array.isArray(route?.geometry) ? route.geometry : []).filter(
    (p) => Number.isFinite(Number(p?.lat)) && Number.isFinite(Number(p?.lon))
  );
  const pois = (Array.isArray(route?.pois) ? route.pois : []).filter(
    (p) => Number.isFinite(Number(p?.lat)) && Number.isFinite(Number(p?.lon))
  );
  const start = pts[0] ?? pois[0] ?? null;
  const end = route?.loop ? start : pts.at(-1) ?? pois.at(-1) ?? start;
  return { start, end };
}

function defaultName(route, opts) {
  const city = opts?.cityName ? ` — ${opts.cityName}` : '';
  if (route?.label) return `${route.label}${city}`;
  return `${route?.loop ? 'Boucle de flânerie' : 'Itinéraire enrichi'}${city}`;
}

function defaultDescription(route, opts) {
  const km = (((route?.distance ?? 0)) / 1000).toFixed(1).replace('.', ',');
  const min = Math.round((route?.duration ?? 0) / 60);
  const mode = TRAVEL_MODE_LABELS[normalizeTravelMode(opts.travelMode)];
  const n = (route?.pois ?? []).length;
  return `Généré par Détours — ${km} km, environ ${min} min ${mode}, ${n} POI sur le chemin.`;
}

// --- URLs des applis de cartographie ---

/**
 * Google Maps (URL universelle « dir/?api=1 ») : origine, destination, étapes POI
 * et mode de transport. Pour une boucle, origine = destination.
 */
export function gmapsUrl(route, opts = {}) {
  const { start, end } = endpoints(route);
  if (!start) return '';
  const parts = ['api=1', `origin=${ll(start)}`, `destination=${ll(end ?? start)}`];
  const waypoints = (Array.isArray(route?.pois) ? route.pois : [])
    .map((p) => ll(p))
    .filter((w) => w !== null);
  if (waypoints.length > 0) parts.push(`waypoints=${waypoints.join('|')}`);
  parts.push(`travelmode=${normalizeTravelMode(opts.travelMode)}`);
  return `https://www.google.com/maps/dir/?${parts.join('&')}`;
}

/**
 * Apple Plans : saddr → daddr, avec dirflg=w (à pied) ou d (en voiture).
 * Apple Plans ne prend pas les étapes intermédiaires en URL, et ne gère pas le vélo :
 * pour 'bicycling' on omet dirflg et on laisse Plans choisir le mode.
 */
export function appleMapsUrl(route, opts = {}) {
  const { start, end } = endpoints(route);
  if (!start) return '';
  const parts = [`saddr=${ll(start)}`, `daddr=${ll(end ?? start)}`];
  const dirflg = { walking: 'w', driving: 'd' }[normalizeTravelMode(opts.travelMode)];
  if (dirflg) parts.push(`dirflg=${dirflg}`);
  return `https://maps.apple.com/?${parts.join('&')}`;
}

/**
 * Waze (URL web « /ul » qui ouvre l'app si installée) : une seule destination,
 * avec navigation lancée. Waze ne prend ni étapes ni mode de transport en URL.
 */
export function wazeUrl(route, opts = {}) {
  const { start, end } = endpoints(route);
  const target = end ?? start;
  if (!target) return '';
  return `https://www.waze.com/ul?ll=${ll(target)}&navigate=yes`;
}

/**
 * URI geo: (Android) : un seul point, donc l'arrivée de l'itinéraire
 * (le départ pour une boucle), avec un libellé lisible par l'app de cartes choisie.
 */
export function geoUri(route, opts = {}) {
  const { start, end } = endpoints(route);
  const target = end ?? start;
  if (!target) return '';
  const label = opts.label ?? opts.name ?? 'Itinéraire Détours';
  const coord = ll(target);
  if (coord === null) return '';
  const q = encodeURIComponent(label).replace(/[()!'*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `geo:${coord}?q=${coord}(${q})`;
}

// --- Fichier GPX 1.1 ---

/**
 * GPX 1.1 valide : un <wpt> par POI (name/desc/link Wikipédia/type) et une <rte>
 * contenant un <rtept> par point de route.geometry. Échappement XML strict partout.
 * opts : { name, description, creator, time (ISO), travelMode, cityName }.
 */
export function buildGpx(route, opts = {}) {
  const name = opts.name ?? defaultName(route, opts);
  const creator = opts.creator ?? 'Détours';
  const time = opts.time ?? new Date().toISOString();
  const desc = opts.description ?? defaultDescription(route, opts);
  const pois = (Array.isArray(route?.pois) ? route.pois : []).filter(
    (p) => fmtCoord(p.lat) !== null && fmtCoord(p.lon) !== null
  );
  const pts = (Array.isArray(route?.geometry) ? route.geometry : []).filter(
    (p) => fmtCoord(p.lat) !== null && fmtCoord(p.lon) !== null
  );

  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<gpx version="1.1" creator="' + escapeXml(creator) + '"');
  out.push('     xmlns="http://www.topografix.com/GPX/1/1"');
  out.push('     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');
  out.push('     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">');
  out.push('  <metadata>');
  out.push('    <name>' + escapeXml(name) + '</name>');
  out.push('    <desc>' + escapeXml(desc) + '</desc>');
  out.push('    <time>' + escapeXml(time) + '</time>');
  out.push('  </metadata>');
  for (const poi of pois) {
    out.push(`  <wpt lat="${fmtCoord(poi.lat)}" lon="${fmtCoord(poi.lon)}">`);
    out.push('    <name>' + escapeXml(poi.name ?? 'POI') + '</name>');
    if (poi.description) out.push('    <desc>' + escapeXml(poi.description) + '</desc>');
    if (poi.wikipedia) {
      out.push('    <link href="' + escapeXml(poi.wikipedia) + '">');
      out.push('      <text>Wikipédia</text>');
      out.push('    </link>');
    }
    if (poi.category) out.push('    <type>' + escapeXml(poi.category) + '</type>');
    out.push('  </wpt>');
  }
  if (pts.length > 0) {
    out.push('  <rte>');
    out.push('    <name>' + escapeXml(name) + '</name>');
    out.push('    <desc>' + escapeXml(desc) + '</desc>');
    for (const p of pts) {
      out.push(`    <rtept lat="${fmtCoord(p.lat)}" lon="${fmtCoord(p.lon)}"></rtept>`);
    }
    out.push('  </rte>');
  }
  out.push('</gpx>');
  return out.join('\n') + '\n';
}

// --- Catalogue des cibles d'export ---

/**
 * Liste des exports proposés pour un itinéraire.
 * Retourne [{ id, label, icon, href, kind: 'link' | 'download', hint }] avec
 * id ∈ google-maps, apple-maps, waze, geo, gpx.
 * La cible gpx est en kind 'download' : son href est un data: URI directement
 * téléchargeable (pratique et testable) — l'UI peut aussi le regénérer via Blob.
 */
export function exportTargets(route, opts = {}) {
  const gpxHref = 'data:application/gpx+xml;charset=utf-8,' + encodeURIComponent(buildGpx(route, opts));
  return [
    {
      id: 'google-maps',
      label: 'Google Maps',
      icon: '🗺️',
      href: gmapsUrl(route, opts),
      kind: 'link',
      hint: 'Avec les étapes POI'
    },
    {
      id: 'apple-maps',
      label: 'Apple Plans',
      icon: '🍎',
      href: appleMapsUrl(route, opts),
      kind: 'link',
      hint: 'De A à B, sans étapes intermédiaires'
    },
    {
      id: 'waze',
      label: 'Waze',
      icon: '🚗',
      href: wazeUrl(route, opts),
      kind: 'link',
      hint: 'Navigation lancée vers la destination'
    },
    {
      id: 'geo',
      label: 'Android (geo:)',
      icon: '🤖',
      href: geoUri(route, opts),
      kind: 'link',
      hint: "Ouvre l'arrivée dans votre appli de cartes"
    },
    {
      id: 'gpx',
      label: 'Fichier GPX',
      icon: '📥',
      href: gpxHref,
      kind: 'download',
      hint: 'Universel : OsmAnd, Garmin, Komoot, Strava…'
    }
  ];
}
