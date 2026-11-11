import { CATEGORIES } from '../src/engine.js';
import { planRoute } from '../src/router.js';

let markers = [];

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
  markers.forEach((m) => m.remove());
  markers = route.pois.map((p, i) => {
    const btn = document.createElement('button');
    btn.className = 'poi-marker';
    btn.textContent = i + 1;
    btn.title = p.name;
    btn.addEventListener('click', () => {
      const card = el('poiList').querySelector(`.poi-card[data-rank="${i + 1}"]`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        card.classList.add('active');
        setTimeout(() => card.classList.remove('active'), 1500);
      }
    });
    return new maplibregl.Marker({ element: btn }).setLngLat([p.lon, p.lat]).addTo(map);
  });

  const bounds = line.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(line[0], line[0]));
  map.fitBounds(bounds, { padding: 60 });

  el('profile').hidden = false;
  el('stats').innerHTML = `
    <li><strong>Distance :</strong> ${(route.distance / 1000).toFixed(2)} km (direct : ${(route.directDistance / 1000).toFixed(2)} km)</li>
    <li><strong>Durée estimée :</strong> ${Math.round(route.duration / 60)} min</li>
    <li><strong>Détour :</strong> +${Math.round(route.detour * 100)} %</li>
    <li><strong>POI :</strong> ${route.pois.length}</li>
    <li><strong>Score intérêt / détour :</strong> ${route.score.toFixed(2)}</li>`;
  if (route.pois.length === 0 && route.bestMissed) {
    const m = route.bestMissed;
    el('stats').innerHTML += `
    <li class="hint"><strong>Aucun POI dans le plafond de détour.</strong><br />
    Le plus accessible : ${m.poi.name} (+${Math.round(m.detour * 100)} % de détour).<br />
    Augmentez le curseur « Détour maximal » pour l'inclure.</li>`;
  } else if (route.pois.length === 0) {
    el('stats').innerHTML += `
    <li class="hint"><strong>Aucun POI sur ce trajet.</strong><br />Essayez d'autres catégories ou un itinéraire plus long.</li>`;
  }
  el('poiList').innerHTML = route.pois.map((p, i) => `
    <li class="poi-card" data-rank="${i + 1}" data-lat="${p.lat}" data-lon="${p.lon}">
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

