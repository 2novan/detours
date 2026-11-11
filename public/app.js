import { buildRoute } from '../src/engine.js';
import { CATEGORIES } from '../src/engine.js';

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/liberty',
  center: [2.3522, 48.8566],
  zoom: 13,
  attributionControl: { compact: true }
});

const city = await (await fetch('/data/cities/paris.json')).json();
const pois = city.pois;
const speeds = { walk: 1.35, bike: 4.2 };

const el = (id) => document.getElementById(id);
const interestLabel = el('interestLabel');
el('form').addEventListener('submit', onSubmit);
el('interest').addEventListener('input', (e) => {
  const v = parseFloat(e.target.value);
  interestLabel.textContent = v < 0.25 ? 'Rapide' : v < 0.5 ? 'Plutôt rapide' : v < 0.75 ? 'Équilibré' : 'Intéressant';
});
el('maxDetour').addEventListener('input', (e) => {
  el('detourLabel').textContent = `+${Math.round(parseFloat(e.target.value) * 100)} %`;
});

function setLine(id, coordinates) {
  const data = { type: 'Feature', geometry: { type: 'LineString', coordinates } };
  if (map.getSource(id)) map.getSource(id).setData(data);
  else map.addSource(id, { type: 'geojson', data });
}

function resolvePlace(input) {
  const coords = input.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (coords) return { lat: parseFloat(coords[1]), lon: parseFloat(coords[2]) };
  const needle = input.trim().toLowerCase();
  const poi = pois.find((p) => p.name.toLowerCase().includes(needle));
  if (poi) return { lat: poi.lat, lon: poi.lon };
  return null;
}

async function onSubmit(e) {
  e.preventDefault();
  const start = resolvePlace(el('start').value);
  const end = resolvePlace(el('end').value);
  const msg = 'Point introuvable. Utilisez un nom de POI connu ou des coordonnées "lat, lon".';
  if (!start || !end) return void alert(msg);
  const categories = [...document.querySelectorAll('input[name="cat"]:checked')].map((c) => c.value);
  if (categories.length === 0) return void alert('Choisissez au moins une catégorie de POI.');
  const route = buildRoute(start, end, pois, {
    interest: parseFloat(el('interest').value),
    maxDetour: parseFloat(el('maxDetour').value),
    speed: speeds[el('mode').value],
    categories: categories.length ? categories : CATEGORIES
  });
  render(route);
}

function render(route) {
  const line = route.points.map((p) => [p.lon, p.lat]);
  const direct = [line[0], line.at(-1)];
  setLine('route', line);
  setLine('direct', direct);
  if (!map.getLayer('direct-line')) {
    map.addLayer({ id: 'direct-line', type: 'line', source: 'direct', paint: { 'line-color': '#999', 'line-dasharray': [2, 3], 'line-width': 2 } });
    map.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': '#b3541e', 'line-width': 4 } });
  }
  const poiData = poiFeatureCollection(route.pois);
  if (map.getSource('route-pois')) {
    map.getSource('route-pois').setData(poiData);
  } else {
    map.addSource('route-pois', { type: 'geojson', data: poiData });
    map.addLayer({ id: 'poi-points', type: 'circle', source: 'route-pois', paint: { 'circle-color': '#2a6f4e', 'circle-radius': 7, 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } });
  }

  const bounds = line.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(line[0], line[0]));
  map.fitBounds(bounds, { padding: 60 });

  el('profile').hidden = false;
  el('stats').innerHTML = `
    <li><strong>Distance :</strong> ${(route.distance / 1000).toFixed(2)} km (direct : ${(route.directDistance / 1000).toFixed(2)} km)</li>
    <li><strong>Durée estimée :</strong> ${Math.round(route.duration / 60)} min</li>
    <li><strong>Détour :</strong> +${Math.round(route.detour * 100)} %</li>
    <li><strong>POI :</strong> ${route.pois.length}</li>
    <li><strong>Score intérêt / détour :</strong> ${route.score.toFixed(2)}</li>`;
  el('poiList').innerHTML = route.pois.map((p, i) => `
    <li class="poi-card">
      ${p.image ? `<img src="${p.image}" alt="${p.name}" loading="lazy" />` : ''}
      <h3>${i + 1}. ${p.name}</h3>
      <p class="cat-${p.category}">${p.category}</p>
      <p>${p.description}</p>
    </li>`).join('');
}

function poiFeatureCollection(pois) {
  return {
    type: 'FeatureCollection',
    features: pois.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: { name: p.name, description: p.description }
    }))
  };
}