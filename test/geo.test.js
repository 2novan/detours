import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDistance, haversine, totalDistance, interpolate, EARTH_RADIUS_M } from '../src/geo.js';

// ---------------------------------------------------------------------------
// Exemples de la spec
// ---------------------------------------------------------------------------
test('exemples de la spec : 950 -> "950 m", 1500 -> "1,5 km"', () => {
  assert.equal(formatDistance(950), '950 m');
  assert.equal(formatDistance(1500), '1,5 km');
});

// ---------------------------------------------------------------------------
// Branche kilomètres : pas de décimale inutile, 1 chiffre max, virgule FR
// ---------------------------------------------------------------------------
test('branche km : 1000 -> "1 km" (pas de décimale inutile)', () => {
  assert.equal(formatDistance(1000), '1 km');
});

test('branche km : 1234 -> "1,2 km" (arrondi à 1 décimale)', () => {
  assert.equal(formatDistance(1234), '1,2 km');
});

test('branche km : 12345 -> "12,3 km" (pas d\'artefact de virgule flottante)', () => {
  assert.equal(formatDistance(12345), '12,3 km');
  assert.ok(!formatDistance(12345).includes('000000'), 'aucun artefact de virgule flottante');
});

// ---------------------------------------------------------------------------
// Branche mètres (choisie sur la valeur d'entrée, pas sur l'arrondi)
// ---------------------------------------------------------------------------
test('branche mètres : 0 -> "0 m"', () => {
  assert.equal(formatDistance(0), '0 m');
});

test('branche mètres : 999 -> "999 m"', () => {
  assert.equal(formatDistance(999), '999 m');
});

test('branche choisie sur l\'entrée : 999.5 -> "1000 m" (et pas "1 km")', () => {
  assert.equal(formatDistance(999.5), '1000 m');
});

test('branche mètres : 950.4 -> "950 m" (arrondi à l\'entier le plus proche)', () => {
  assert.equal(formatDistance(950.4), '950 m');
});

// ---------------------------------------------------------------------------
// Entrées invalides / non finies -> '0 m'
// ---------------------------------------------------------------------------
test('cas limites : NaN, Infinity, -Infinity, null, undefined, chaîne -> "0 m"', () => {
  assert.equal(formatDistance(NaN), '0 m');
  assert.equal(formatDistance(Infinity), '0 m');
  assert.equal(formatDistance(-Infinity), '0 m');
  assert.equal(formatDistance(null), '0 m');
  assert.equal(formatDistance(undefined), '0 m');
  assert.equal(formatDistance('1500'), '0 m');
  assert.equal(formatDistance('abc'), '0 m');
  assert.equal(formatDistance(''), '0 m');
  assert.equal(formatDistance({}), '0 m');
  assert.equal(formatDistance([1500]), '0 m');
  assert.equal(formatDistance(true), '0 m');
});

// ---------------------------------------------------------------------------
// Négatifs : le signe est conservé
// ---------------------------------------------------------------------------
test('négatifs : -1500 -> "-1,5 km", -950 -> "-950 m"', () => {
  assert.equal(formatDistance(-1500), '-1,5 km');
  assert.equal(formatDistance(-950), '-950 m');
});

test('négatifs supplémentaires : -1000, -1234, -999.5', () => {
  assert.equal(formatDistance(-1000), '-1 km');
  assert.equal(formatDistance(-1234), '-1,2 km');
  assert.equal(formatDistance(-999.5), '-1000 m');
});

// ---------------------------------------------------------------------------
// Frontières d'arrondi et absence d'artefacts de virgule flottante
// ---------------------------------------------------------------------------
test('frontières d\'arrondi autour de 1 km / 1,1 km / 1,2 km', () => {
  assert.equal(formatDistance(999.4), '999 m');    // branche m, arrondi à 999
  assert.equal(formatDistance(1049.9), '1 km');     // 1,04999 km -> "1 km"
  assert.equal(formatDistance(1050), '1,1 km');     // 1,05 km -> 1,1 (Math.round half up)
  assert.equal(formatDistance(1150), '1,2 km');     // 1,15 km -> 1,2
  assert.equal(formatDistance(1549.99), '1,5 km');  // 1,549999 -> 1,5
  assert.equal(formatDistance(1550), '1,6 km');     // 1,55 -> 1,6
});

test('artefacts de virgule flottante : format km toujours de la forme -?N(,D) km', () => {
  const values = [1234, 12345, 12345.6, 123456, 1000000, 999949, 999999, 1050, 1150, 2500, 3333, 7777, 12345];
  for (const v of values) {
    const out = formatDistance(v);
    assert.match(out, /^-?\d+(,\d)? km$/, `format non conforme pour ${v} : ${out}`);
    assert.ok(!out.includes('00000'), `artefact de virgule flottante pour ${v} : ${out}`);
  }
});

test('grandes valeurs : 1000000 -> "1000 km", 999949 -> "999,9 km", 999999 -> "1000 km"', () => {
  assert.equal(formatDistance(1000000), '1000 km');
  assert.equal(formatDistance(999949), '999,9 km');
  assert.equal(formatDistance(999999), '1000 km');
});

test('petites valeurs : 0.4 -> "0 m", 0.5 -> "1 m"', () => {
  assert.equal(formatDistance(0.4), '0 m');
  assert.equal(formatDistance(0.5), '1 m');
});

// ---------------------------------------------------------------------------
// Table récapitulative (cas nominaux + limites)
// ---------------------------------------------------------------------------
test('table récapitulative des valeurs attendues', () => {
  const cases = [
    [950, '950 m'],
    [1500, '1,5 km'],
    [1000, '1 km'],
    [1234, '1,2 km'],
    [12345, '12,3 km'],
    [0, '0 m'],
    [999, '999 m'],
    [999.5, '1000 m'],
    [950.4, '950 m'],
    [NaN, '0 m'],
    [Infinity, '0 m'],
    [-Infinity, '0 m'],
    [null, '0 m'],
    [undefined, '0 m'],
    ['1500', '0 m'],
    [-1500, '-1,5 km'],
    [-950, '-950 m'],
    [1050, '1,1 km'],
    [1150, '1,2 km'],
    [999.4, '999 m'],
    [1000000, '1000 km']
  ];
  for (const [input, expected] of cases) {
    assert.equal(formatDistance(input), expected, `formatDistance(${String(input)})`);
  }
});

// ---------------------------------------------------------------------------
// Sanity check : formatDistance ne doit pas casser les autres exports de geo.js
// ---------------------------------------------------------------------------
test('sanity : haversine fonctionne toujours (Tour Eiffel -> Louvre ~ 3,2 km)', () => {
  const eiffel = { lat: 48.8584, lon: 2.2945 };
  const louvre = { lat: 48.8606, lon: 2.3376 };
  const d = haversine(eiffel, louvre);
  assert.equal(typeof d, 'number');
  assert.ok(Number.isFinite(d));
  assert.ok(d > 3000 && d < 3500, `distance haversine crédible attendue (~3,2 km), reçu ${d}`);
  assert.equal(haversine(eiffel, eiffel), 0, 'deux points identiques -> 0');
});

test('sanity : les autres exports de src/geo.js sont toujours présents et fonctionnels', () => {
  assert.equal(EARTH_RADIUS_M, 6371000);
  const a = { lat: 48.8584, lon: 2.2945 };
  const b = { lat: 48.8606, lon: 2.3376 };
  const pts = [a, b, { lat: 48.8566, lon: 2.3522 }];
  const total = totalDistance(pts);
  assert.ok(total > haversine(a, b), 'totalDistance somme les étapes');
  const mid = interpolate(a, b, 0.5);
  assert.ok(Math.abs(mid.lat - (a.lat + b.lat) / 2) < 1e-12);
  assert.ok(Math.abs(mid.lon - (a.lon + b.lon) / 2) < 1e-12);
  assert.equal(totalDistance([a]), 0, 'un seul point -> distance 0');
  assert.equal(totalDistance([]), 0, 'aucun point -> distance 0');
});
