import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeXml,
  buildGpx,
  gmapsUrl,
  appleMapsUrl,
  wazeUrl,
  geoUri,
  exportTargets
} from '../src/export.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const START = { lat: 48.8584, lon: 2.2945 };
const MID = { lat: 48.86, lon: 2.35 };
const END = { lat: 48.853, lon: 2.3499 };

const POIS = [
  {
    name: 'Tour Eiffel',
    description: 'Symbole de Paris',
    wikipedia: 'https://fr.wikipedia.org/wiki/Tour_Eiffel',
    category: 'monument',
    lat: 48.8584,
    lon: 2.2945
  },
  {
    name: 'Musée du Louvre',
    description: 'Le plus grand musée du monde',
    wikipedia: 'https://fr.wikipedia.org/wiki/Mus%C3%A9e_du_Louvre',
    category: 'musee',
    lat: 48.8606,
    lon: 2.3376
  }
];

const route = {
  label: 'Balade parisienne',
  loop: false,
  distance: 4200,
  duration: 3600,
  geometry: [START, MID, END],
  pois: POIS
};

// ---------------------------------------------------------------------------
// Helper : validation structurelle d'un document XML (pile de balises)
// ---------------------------------------------------------------------------
function assertWellFormedXml(xml) {
  assert.equal(typeof xml, 'string');
  const tagRe = /<(\/?)([A-Za-z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^'"<>])*)>/g;
  const stack = [];
  let m;
  while ((m = tagRe.exec(xml)) !== null) {
    const [, closing, name] = m;
    if (m[0].endsWith('/>')) continue; // balise auto-fermante
    if (closing === '/') {
      assert.ok(stack.length > 0, `balise fermante </${name}> sans ouvrante`);
      const top = stack.pop();
      assert.equal(top, name, `</${name}> ferme <${top}> — balises mal imbriquées`);
    } else {
      stack.push(name);
    }
  }
  assert.deepEqual(stack, [], `balises non fermées : ${stack.join(', ')}`);
}

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

// ---------------------------------------------------------------------------
// escapeXml : les 5 caractères réservés, échappés sans double échappement
// ---------------------------------------------------------------------------
test('escapeXml : les 5 caractères & < > " \' sont échappés', () => {
  assert.equal(escapeXml(`&<>"'`), '&amp;&lt;&gt;&quot;&apos;');
});

test('escapeXml : & est traité en premier (pas de double échappement)', () => {
  assert.equal(escapeXml('&amp;'), '&amp;amp;');
  assert.equal(escapeXml('&lt;'), '&amp;lt;');
});

test('escapeXml : chaîne vide, null et undefined -> chaîne vide', () => {
  assert.equal(escapeXml(''), '');
  assert.equal(escapeXml(null), '');
  assert.equal(escapeXml(undefined), '');
});

test('escapeXml : les nombres sont convertis en chaîne', () => {
  assert.equal(escapeXml(42), '42');
});

// ---------------------------------------------------------------------------
// buildGpx : structure du document
// ---------------------------------------------------------------------------
test('buildGpx : déclaration XML, gpx 1.1, creator, namespaces', () => {
  const gpx = buildGpx(route, { creator: 'Détours' });
  assert.ok(gpx.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'déclaration XML en tête');
  assert.match(gpx, /<gpx version="1\.1" creator="Détours"/);
  assert.ok(gpx.includes('xmlns="http://www.topografix.com/GPX/1/1"'), 'namespace GPX 1.1');
  assert.ok(gpx.includes('xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'), 'namespace xsi');
  assert.ok(
    gpx.includes('xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd"'),
    'schemaLocation'
  );
  assert.ok(gpx.trimEnd().endsWith('</gpx>'), 'document fermé par </gpx>');
});

test('buildGpx : le XML produit est bien formé (toutes les balises sont équilibrées)', () => {
  assertWellFormedXml(buildGpx(route));
  assertWellFormedXml(buildGpx({ ...route, pois: [], geometry: [] }));
  assertWellFormedXml(
    buildGpx({
      geometry: [{ lat: 48.85, lon: 2.29 }],
      pois: [{ name: 'A & B <c> "d" \'e\'', description: '<x>&"', wikipedia: 'https://w/?a="1"&b=<2>', category: '&', lat: 48.85, lon: 2.29 }]
    })
  );
});

test('buildGpx : metadata contient name, desc et time', () => {
  const time = '2026-01-02T03:04:05.000Z';
  const gpx = buildGpx(route, { name: 'Ma balade', description: 'Une belle desc', time });
  const meta = gpx.match(/<metadata>([\s\S]*?)<\/metadata>/);
  assert.ok(meta, 'bloc <metadata> présent');
  assert.ok(meta[1].includes('<name>Ma balade</name>'), 'metadata/name');
  assert.ok(meta[1].includes('<desc>Une belle desc</desc>'), 'metadata/desc');
  assert.ok(meta[1].includes(`<time>${time}</time>`), 'metadata/time');
});

test('buildGpx : opts.time par défaut = horodatage ISO valide', () => {
  const gpx = buildGpx(route);
  const m = gpx.match(/<time>([^<]*)<\/time>/);
  assert.ok(m, 'balise <time> présente');
  assert.ok(!Number.isNaN(Date.parse(m[1])), `time est une date ISO valide, reçu ${m[1]}`);
});

test('buildGpx : un <wpt> par POI avec lat/lon et name/desc/link/type', () => {
  const gpx = buildGpx(route);
  assert.equal(count(gpx, '<wpt '), POIS.length, 'un wpt par POI');
  const wpts = gpx.match(/<wpt [^>]*>[\s\S]*?<\/wpt>/g) ?? [];
  assert.equal(wpts.length, POIS.length);
  const [wpt1] = wpts;
  assert.ok(wpt1.includes('lat="48.858400"') && wpt1.includes('lon="2.294500"'), 'attributs lat/lon à 6 décimales');
  assert.ok(wpt1.includes('<name>Tour Eiffel</name>'), 'wpt/name');
  assert.ok(wpt1.includes('<desc>Symbole de Paris</desc>'), 'wpt/desc');
  assert.ok(
    wpt1.includes('<link href="https://fr.wikipedia.org/wiki/Tour_Eiffel">'),
    'wpt/link wikipedia'
  );
  assert.ok(wpt1.includes('<text>Wikipédia</text>'), 'texte du lien');
  assert.ok(wpt1.includes('<type>monument</type>'), 'wpt/type = catégorie');
});

test('buildGpx : <rte> avec un <rtept> par point de geometry', () => {
  const gpx = buildGpx(route);
  assert.equal(count(gpx, '<rte>'), 1, 'une seule balise <rte>');
  assert.equal(count(gpx, '<rtept '), route.geometry.length, 'un rtept par point de geometry');
  const rte = gpx.match(/<rte>[\s\S]*?<\/rte>/)[0];
  for (const p of route.geometry) {
    const lat = Number(p.lat).toFixed(6);
    const lon = Number(p.lon).toFixed(6);
    assert.ok(rte.includes(`<rtept lat="${lat}" lon="${lon}"></rtept>`), `rtept ${lat},${lon} présent`);
  }
});

// ---------------------------------------------------------------------------
// buildGpx : échappement XML strict d'un POI hostile
// ---------------------------------------------------------------------------
test('buildGpx : & < > " \' dans name/description/wikipedia sont échappés (XML toujours bien formé)', () => {
  const hostile = {
    geometry: [{ lat: 48.85, lon: 2.29 }],
    pois: [
      {
        name: `A & B <tag> "quote" 'apos'`,
        description: `Desc & <b> "x" 'y'`,
        wikipedia: 'https://w.example/?a="1"&b=<2>',
        category: 'cat&<gorie>',
        lat: 48.85,
        lon: 2.29
      }
    ]
  };
  const gpx = buildGpx(hostile, { name: 'N&<a>me', description: 'D&<e>sc' });
  assertWellFormedXml(gpx);
  assert.ok(gpx.includes('<name>A &amp; B &lt;tag&gt; &quot;quote&quot; &apos;apos&apos;</name>'), 'name échappé');
  assert.ok(gpx.includes('<desc>Desc &amp; &lt;b&gt; &quot;x&quot; &apos;y&apos;</desc>'), 'desc échappé');
  assert.ok(
    gpx.includes('<link href="https://w.example/?a=&quot;1&quot;&amp;b=&lt;2&gt;">'),
    'attribut href échappé'
  );
  assert.ok(gpx.includes('<type>cat&amp;&lt;gorie&gt;</type>'), 'type échappé');
  assert.ok(!gpx.includes('<tag>'), 'pas de balise injectée via le name');
  assert.ok(!gpx.includes('"1"'), 'pas de guillemet brut dans un attribut');
});

// ---------------------------------------------------------------------------
// buildGpx : cas limites
// ---------------------------------------------------------------------------
test('buildGpx : route sans POI -> aucun <wpt>, mais la <rte> est toujours là', () => {
  const gpx = buildGpx({ geometry: [START, END], pois: [] });
  assertWellFormedXml(gpx);
  assert.equal(count(gpx, '<wpt '), 0, 'aucun wpt');
  assert.equal(count(gpx, '<rtept '), 2, 'rte intacte');
});

test('buildGpx : geometry à 1 point -> rte avec exactement 1 rtept', () => {
  const gpx = buildGpx({ geometry: [START], pois: [] });
  assertWellFormedXml(gpx);
  assert.equal(count(gpx, '<rtept '), 1);
  assert.ok(gpx.includes('<rtept lat="48.858400" lon="2.294500"></rtept>'));
});

test('buildGpx : boucle (loop: true) -> GPX bien formé, name par défaut « Boucle de flânerie »', () => {
  const loopRoute = { loop: true, distance: 1000, duration: 600, geometry: [START, MID, START], pois: [] };
  const gpx = buildGpx(loopRoute);
  assertWellFormedXml(gpx);
  assert.ok(gpx.includes('<name>Boucle de flânerie</name>'), 'nom par défaut de boucle');
  assert.equal(count(gpx, '<rtept '), 3);
});

test('buildGpx : coordonnées NaN -> aucun wpt/rtept avec 0.000000 (points filtrés)', () => {
  const nanRoute = {
    geometry: [{ lat: NaN, lon: 2.29 }, { lat: 48.85, lon: NaN }, { lat: Infinity, lon: 2.3 }],
    pois: [{ name: 'Fantôme', lat: NaN, lon: NaN }]
  };
  const gpx = buildGpx(nanRoute);
  assertWellFormedXml(gpx);
  assert.equal(count(gpx, '<wpt '), 0, 'POI NaN filtré');
  assert.equal(count(gpx, '<rtept '), 0, 'tous les points NaN filtrés -> pas de rte');
  assert.ok(!gpx.includes('0.000000'), 'aucune coordonnée fictive 0.000000');
  assert.ok(!gpx.includes('NaN'), 'jamais de NaN dans le XML');
  assert.ok(!gpx.includes('Infinity'), 'jamais de Infinity dans le XML');
});

test('buildGpx(null) ne plante pas et retourne un GPX bien formé', () => {
  let gpx;
  assert.doesNotThrow(() => { gpx = buildGpx(null); });
  assert.equal(typeof gpx, 'string');
  assert.ok(gpx.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assertWellFormedXml(gpx);
  assert.equal(count(gpx, '<wpt '), 0);
  assert.equal(count(gpx, '<rtept '), 0);
});

test('buildGpx(undefined) et buildGpx({}) ne plantent pas non plus', () => {
  assert.doesNotThrow(() => buildGpx(undefined));
  assert.doesNotThrow(() => buildGpx({}));
  assertWellFormedXml(buildGpx({}));
});

// ---------------------------------------------------------------------------
// gmapsUrl
// ---------------------------------------------------------------------------
test('gmapsUrl : origin et destination présents, format dir/?api=1', () => {
  const url = gmapsUrl(route);
  assert.ok(url.startsWith('https://www.google.com/maps/dir/?api=1&'), `URL gmaps, reçu ${url}`);
  assert.ok(url.includes('origin=48.858400,2.294500'), 'origin = premier point de geometry');
  assert.ok(url.includes('destination=48.853000,2.349900'), 'destination = dernier point de geometry');
});

test('gmapsUrl : waypoints = POI séparés par |', () => {
  const url = gmapsUrl(route);
  assert.ok(
    url.includes('waypoints=48.858400,2.294500|48.860600,2.337600'),
    `waypoints séparés par |, reçu ${url}`
  );
});

test('gmapsUrl : travelmode=walking par défaut, bicycling et driving pris en compte', () => {
  assert.ok(gmapsUrl(route).includes('travelmode=walking'), 'walking par défaut');
  assert.ok(gmapsUrl(route, {}).includes('travelmode=walking'), 'opts vide -> walking');
  assert.ok(gmapsUrl(route, { travelMode: 'bicycling' }).includes('travelmode=bicycling'));
  assert.ok(gmapsUrl(route, { travelMode: 'driving' }).includes('travelmode=driving'));
  assert.ok(gmapsUrl(route, { travelMode: 'teleport' }).includes('travelmode=walking'), 'mode inconnu -> walking');
});

test('gmapsUrl : boucle (loop: true) -> origin == destination', () => {
  const url = gmapsUrl({ ...route, loop: true });
  const origin = url.match(/origin=([^&]*)/)[1];
  const dest = url.match(/destination=([^&]*)/)[1];
  assert.equal(origin, dest, 'origine = destination pour une boucle');
  assert.equal(origin, '48.858400,2.294500');
});

test('gmapsUrl : waypoints avec coordonnées NaN filtrés', () => {
  const r = {
    geometry: [START, END],
    pois: [
      { name: 'ok', lat: 48.86, lon: 2.35 },
      { name: 'nan', lat: NaN, lon: 2.35 },
      { name: 'nan2', lat: 48.86, lon: NaN }
    ]
  };
  const url = gmapsUrl(r);
  assert.ok(url.includes('waypoints=48.860000,2.350000'), 'seul le POI valide est gardé');
  assert.ok(!url.includes('NaN'), 'jamais de NaN dans l\'URL');
  assert.ok(!url.includes('null'), 'jamais de null dans l\'URL');
});

test('gmapsUrl : route sans POI -> pas de paramètre waypoints', () => {
  const url = gmapsUrl({ geometry: [START, END], pois: [] });
  assert.ok(!url.includes('waypoints='), 'pas de waypoints vide');
});

test('gmapsUrl : route null -> chaîne vide (pas de crash)', () => {
  assert.equal(gmapsUrl(null), '');
  assert.equal(gmapsUrl({}), '');
});

// ---------------------------------------------------------------------------
// appleMapsUrl
// ---------------------------------------------------------------------------
test('appleMapsUrl : saddr et daddr présents', () => {
  const url = appleMapsUrl(route);
  assert.ok(url.startsWith('https://maps.apple.com/?'), `URL apple, reçu ${url}`);
  assert.ok(url.includes('saddr=48.858400,2.294500'));
  assert.ok(url.includes('daddr=48.853000,2.349900'));
});

test('appleMapsUrl : dirflg=w pour walking, d pour driving, absent pour bicycling', () => {
  assert.ok(appleMapsUrl(route, { travelMode: 'walking' }).includes('dirflg=w'));
  assert.ok(appleMapsUrl(route).includes('dirflg=w'), 'walking par défaut');
  assert.ok(appleMapsUrl(route, { travelMode: 'driving' }).includes('dirflg=d'));
  const bike = appleMapsUrl(route, { travelMode: 'bicycling' });
  assert.ok(!bike.includes('dirflg'), `pas de dirflg pour bicycling, reçu ${bike}`);
});

test('appleMapsUrl : boucle -> saddr == daddr ; route null -> chaîne vide', () => {
  const loop = appleMapsUrl({ ...route, loop: true });
  assert.equal(loop.match(/saddr=([^&]*)/)[1], loop.match(/daddr=([^&]*)/)[1]);
  assert.equal(appleMapsUrl(null), '');
});

// ---------------------------------------------------------------------------
// wazeUrl
// ---------------------------------------------------------------------------
test('wazeUrl : waze.com/ul?ll=lat,lon&navigate=yes vers la destination', () => {
  const url = wazeUrl(route);
  assert.equal(url, 'https://www.waze.com/ul?ll=48.853000,2.349900&navigate=yes');
});

test('wazeUrl : boucle -> cible = le départ', () => {
  const url = wazeUrl({ ...route, loop: true });
  assert.equal(url, 'https://www.waze.com/ul?ll=48.858400,2.294500&navigate=yes');
});

test('wazeUrl : route null -> chaîne vide', () => {
  assert.equal(wazeUrl(null), '');
  assert.equal(wazeUrl({}), '');
});

// ---------------------------------------------------------------------------
// geoUri
// ---------------------------------------------------------------------------
test('geoUri : schéma geo:lat,lon?q=lat,lon(label) avec label encodé', () => {
  const uri = geoUri(route, { label: 'Tour Eiffel (Paris)' });
  assert.ok(uri.startsWith('geo:48.853000,2.349900?q=48.853000,2.349900('), `schéma geo:, reçu ${uri}`);
  assert.ok(uri.endsWith(')'), 'label entre parenthèses');
  assert.ok(uri.includes('Tour%20Eiffel'), 'espace encodé %20');
  assert.ok(uri.includes('%28Paris%29'), 'parenthèses encodées %28/%29');
});

test('geoUri : label par défaut quand aucun label fourni', () => {
  const uri = geoUri(route);
  assert.ok(uri.includes('q=48.853000,2.349900('), 'q présent');
  assert.ok(
    uri.includes('Itin%C3%A9raire%20D%C3%A9tours'),
    `label par défaut encodé, reçu ${uri}`
  );
});

test('geoUri : boucle -> point = départ ; route null -> chaîne vide', () => {
  assert.ok(geoUri({ ...route, loop: true }).startsWith('geo:48.858400,2.294500?'));
  assert.equal(geoUri(null), '');
});

// ---------------------------------------------------------------------------
// exportTargets
// ---------------------------------------------------------------------------
test('exportTargets : 5 cibles dans l\'ordre google-maps, apple-maps, waze, geo, gpx', () => {
  const targets = exportTargets(route);
  assert.equal(targets.length, 5, '5 cibles');
  assert.deepEqual(
    targets.map((t) => t.id),
    ['google-maps', 'apple-maps', 'waze', 'geo', 'gpx'],
    'ordre des cibles'
  );
  for (const t of targets) {
    assert.ok(t.label && typeof t.label === 'string', `label renseigné pour ${t.id}`);
    assert.ok(t.icon, `icône renseignée pour ${t.id}`);
    assert.ok(['link', 'download'].includes(t.kind), `kind valide pour ${t.id}`);
  }
});

test('exportTargets : gpx est en kind download avec un href data:application/gpx+xml', () => {
  const gpx = exportTargets(route).find((t) => t.id === 'gpx');
  assert.equal(gpx.kind, 'download');
  assert.ok(
    gpx.href.startsWith('data:application/gpx+xml'),
    `href data: GPX, reçu ${gpx.href.slice(0, 60)}…`
  );
  // le data URI doit se décoder en un GPX bien formé
  const decoded = decodeURIComponent(gpx.href.slice(gpx.href.indexOf(',') + 1));
  assertWellFormedXml(decoded);
  assert.ok(decoded.includes('<rtept '), 'le GPX embarqué contient la route');
});

test('exportTargets : chaque href de lien est non vide pour une route valide', () => {
  const targets = exportTargets(route);
  for (const t of targets) {
    assert.ok(typeof t.href === 'string' && t.href.length > 0, `href non vide pour ${t.id}`);
  }
  const links = targets.filter((t) => t.kind === 'link');
  assert.equal(links.length, 4, '4 cibles lien + 1 download');
  assert.ok(links.find((t) => t.id === 'google-maps').href.startsWith('https://www.google.com/maps/dir/'));
  assert.ok(links.find((t) => t.id === 'apple-maps').href.startsWith('https://maps.apple.com/'));
  assert.ok(links.find((t) => t.id === 'waze').href.startsWith('https://www.waze.com/ul?'));
  assert.ok(links.find((t) => t.id === 'geo').href.startsWith('geo:'));
});

test('exportTargets : travelMode propagé aux cibles (gmaps driving, apple dirflg=d)', () => {
  const targets = exportTargets(route, { travelMode: 'driving' });
  assert.ok(targets.find((t) => t.id === 'google-maps').href.includes('travelmode=driving'));
  assert.ok(targets.find((t) => t.id === 'apple-maps').href.includes('dirflg=d'));
});

test('exportTargets(null) ne plante pas', () => {
  let targets;
  assert.doesNotThrow(() => { targets = exportTargets(null); });
  assert.equal(targets.length, 5);
  assert.ok(targets.find((t) => t.id === 'gpx').href.startsWith('data:application/gpx+xml'));
});
