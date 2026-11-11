import { CATEGORIES } from '../src/engine.js';
import { planRoute } from '../src/router.js';

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
  const button = e.submitter ?? e.target.querySelector('button');
  button.disabled = true;
  button.textContent = 'Calcul…';
  try {
    const route = await planRoute(start, end, pois, {
      interest: parseFloat(el('interest').value),
      maxDetour: parseFloat(el('maxDetour').value),
      speed: speeds[el('mode').value],
      categories: categories.length ? categories : CATEGORIES
    });
    render(route);
  } catch (err) {
    console.error(err);
    alert('Erreur de routage : ' + err.message + '\nVérifiez votre connexion (le routage utilise le serveur public OSRM).');
  } finally {
    button.disabled = false;
    button.textContent = "Générer l'itinéraire";
  }
}

function render(route) {
  const line = route.geometry.map((p) => [p.lon, p.lat]);
  setLine('route', line);
  setLine('direct', [line[0], line.at(-1)]);
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
    map.addLayer({
      id: 'poi-labels', type: 'symbol', source: 'route-pois',
      layout: { 'text-field': ['get', 'rank'], 'text-size': 11, 'text-offset': [0, 0.05], 'text-anchor': 'center' },
      paint: { 'text-color': '#fff' }
    });
    map.on('click', 'poi-points', (e) => {
      const f = e.features[0];
      new maplibregl.Popup().setLngLat(f.geometry.coordinates)
        .setHTML(`<strong>${f.properties.name}</strong><p>${f.properties.description}</p>`)
        .addTo(map);
    });
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
    <li class="poi-card" data-lat="${p.lat}" data-lon="${p.lon}">
      ${p.image ? `<img src="${p.image}" alt="${p.name}" loading="lazy" />` : ''}
      <h3>${i + 1}. ${p.name}</h3>
      <p class="cat-${p.category}">${p.category}</p>
      <p>${p.description}</p>
    </li>`).join('');
  el('poiList').querySelectorAll('.poi-card').forEach((card) => {
    card.addEventListener('click', () => {
      map.flyTo({ center: [parseFloat(card.dataset.lon), parseFloat(card.dataset.lat)], zoom: 16 });
    });
  });
}

function poiFeatureCollection(pois) {
  return {
    type: 'FeatureCollection',
    features: pois.map((p, i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: { rank: i + 1, name: p.name, description: p.description }
    }))
  };
}