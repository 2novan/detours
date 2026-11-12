import { CATEGORIES } from '../src/engine.js';
import { planRoute } from '../src/router.js';
import { planWanderVariants } from '../src/wander.js';

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/liberty',
  center: [2.3522, 48.8566],
  zoom: 12,
  attributionControl: { compact: true }
});

let markers = [];
let state = { city: null, pois: [] };
const speeds = { walk: 1.35, bike: 4.2 };

const el = (id) => document.getElementById(id);
const showScreen = (id) => {
  document.querySelectorAll('.screen').forEach((s) => { s.hidden = s.id !== id; });
};

async function loadCities() {
  const cities = await (await fetch('/api/cities')).json();
  el('cityList').innerHTML = '';
  cities.forEach((c) => {
    const btn = document.createElement('button');
    btn.className = 'big';
    btn.innerHTML = `<strong>${c.name}</strong><br /><span>${c.poiCount} POI · flânerie et itinéraires enrichis</span>`;
    btn.addEventListener('click', () => selectCity(c.id));
    el('cityList').appendChild(btn);
  });
}

async function selectCity(id) {
  const data = await (await fetch(`/data/cities/${id}.json`)).json();
  state = { city: data, pois: data.pois };
  map.flyTo({ center: [data.center.lon, data.center.lat], zoom: data.defaultZoom ?? 13 });
  el('cityName').textContent = data.name;
  el('wanderCityName').textContent = data.name;
  el('routeCityName').textContent = data.name;
  clearResults();
  showScreen('screen-mode');
}

async function resolvePlace(input) {
  const raw = input.trim();
  const coords = raw.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (coords) return { lat: parseFloat(coords[1]), lon: parseFloat(coords[2]) };
  const poi = state.pois.find((p) => p.name.toLowerCase().includes(raw.toLowerCase()));
  if (poi) return { lat: poi.lat, lon: poi.lon };
  const query = state.city ? `${raw}, ${state.city.name}` : raw;
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=fr&q=${encodeURIComponent(query)}`
  );
  if (!res.ok) throw new Error('Géocodage indisponible (Nominatim) — réessayez dans un instant.');
  const results = await res.json();
  if (results.length === 0) return null;
  return { lat: parseFloat(results[0].lat), lon: parseFloat(results[0].lon) };
}

function checkedCategories(name) {
  const cats = [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((c) => c.value);
  return cats.length ? cats : CATEGORIES;
}

el('backToCities').addEventListener('click', () => showScreen('screen-city'));
document.querySelectorAll('#screen-mode .big').forEach((btn) => {
  btn.addEventListener('click', () => showScreen(btn.dataset.mode === 'wander' ? 'screen-wander' : 'screen-route'));
});
document.querySelectorAll('.back').forEach((btn) => {
  btn.addEventListener('click', () => showScreen('screen-mode'));
});

el('interest').addEventListener('input', (e) => {
  const v = parseFloat(e.target.value);
  el('interestLabel').textContent = v < 0.25 ? 'Rapide' : v < 0.5 ? 'Plutôt rapide' : v < 0.75 ? 'Équilibré' : 'Intéressant';
});
el('maxDetour').addEventListener('input', (e) => {
  el('detourLabel').textContent = `+${Math.round(parseFloat(e.target.value) * 100)} %`;
});

async function withBusy(button, fn) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Calcul…';
  try {
    await fn();
  } catch (err) {
    console.error(err);
    alert('Erreur : ' + err.message);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

el('wanderGo').addEventListener('click', () => withBusy(el('wanderGo'), async () => {
  const start = await resolvePlace(el('wanderStart').value);
  if (!start) throw new Error('Point de départ introuvable. Utilisez une adresse, un nom de POI connu ou des coordonnées "lat, lon".');
  const variants = await planWanderVariants(start, state.pois, {
    duration: parseFloat(el('duration').value) * 3600,
    speed: speeds.walk,
    categories: checkedCategories('wcat'),
    city: state.city?.id
  });
  if (variants.length === 0) {
    throw new Error('Aucune boucle trouvée depuis ce point — essayez d\'autres catégories ou un départ plus central.');
  }
  renderVariants(variants);
  renderWander(variants[0]);
}));

el('routeGo').addEventListener('click', () => withBusy(el('routeGo'), async () => {
  const start = await resolvePlace(el('start').value);
  const end = await resolvePlace(el('end').value);
  if (!start || !end) throw new Error('Point A ou B introuvable. Utilisez une adresse, un nom de POI connu ou des coordonnées "lat, lon".');
  const route = await planRoute(start, end, state.pois, {
    interest: parseFloat(el('interest').value),
    maxDetour: parseFloat(el('maxDetour').value),
    speed: speeds[el('mode').value],
    categories: checkedCategories('cat'),
    city: state.city?.id
  });
  el('routeResults').hidden = false;
  renderRoute(route);
}));

function renderVariants(variants) {
  el('wanderResults').hidden = false;
  el('variantList').innerHTML = '';
  variants.forEach((v, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'variant' + (i === 0 ? ' selected' : '');
    btn.innerHTML = `<strong>${v.label}</strong><br />${v.pois.length} POI · ${(v.distance / 1000).toFixed(1)} km · ${Math.round(v.duration / 60)} min`;
    btn.addEventListener('click', () => {
      el('variantList').querySelectorAll('.variant').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      renderWander(v);
    });
    el('variantList').appendChild(btn);
  });
}

function drawRoute(route) {
  const line = route.geometry.map((p) => [p.lon, p.lat]);
  setLine('route', line);
  if (!route.loop) setLine('direct', [line[0], line.at(-1)]);
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
      const card = document.querySelector(`.poi-card[data-rank="${i + 1}"]`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        card.classList.add('active');
        setTimeout(() => card.classList.remove('active'), 1500);
      }
    });
    return new maplibregl.Marker({ element: btn }).setLngLat([p.lon, p.lat]).addTo(map);
  });
  const bounds = line.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(line[0], line[0]));
  const mobile = window.innerWidth < 768;
  map.fitBounds(bounds, {
    padding: {
      top: 30,
      bottom: mobile ? window.innerHeight * 0.6 : 40,
      left: mobile ? 30 : 440,
      right: 30
    }
  });
}

function setLine(id, coordinates) {
  const data = { type: 'Feature', geometry: { type: 'LineString', coordinates } };
  if (map.getSource(id)) map.getSource(id).setData(data);
  else map.addSource(id, { type: 'geojson', data });
}

function poiCardsHtml(pois) {
  return pois.map((p, i) => `
    <li class="poi-card" data-rank="${i + 1}" data-lat="${p.lat}" data-lon="${p.lon}">
      ${p.image ? `<img src="${p.image}" alt="${p.name}" loading="lazy" />` : ''}
      <h3>${i + 1}. ${p.name}</h3>
      <p class="cat-${p.category}">${p.category}</p>
      <p>${p.description}</p>
      ${p.wikipedia ? `<a class="wiki" href="${p.wikipedia}" target="_blank" rel="noopener">En savoir plus — Wikipédia ↗</a>` : ''}
    </li>`).join('');
}

function attachCardNavigation(listId) {
  document.querySelectorAll(`#${listId} .poi-card`).forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.wiki')) return;
      map.flyTo({ center: [parseFloat(card.dataset.lon), parseFloat(card.dataset.lat)], zoom: 16 });
    });
  });
}

function gmapsUrl(route) {
  const pts = route.geometry;
  const origin = `${pts[0].lat},${pts[0].lon}`;
  const dest = `${pts.at(-1).lat},${pts.at(-1).lon}`;
  const waypoints = route.pois.map((p) => `${p.lat},${p.lon}`).join('|');
  let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=walking`;
  if (waypoints) url += `&waypoints=${waypoints}`;
  return url;
}

function renderWander(route) {
  drawRoute(route);
  const g = el('wanderGmaps');
  g.href = gmapsUrl(route);
  g.hidden = false;
  el('wanderProfile').innerHTML = route.overBudget
    ? '<ul><li class="hint"><strong>Durée dépassée.</strong><br />La boucle la plus courte possible dépasse la durée demandée.</li></ul>'
    : '';
  el('wanderPoiList').innerHTML = poiCardsHtml(route.pois);
  attachCardNavigation('wanderPoiList');
}

function renderRoute(route) {
  drawRoute(route);
  const g = el('routeGmaps');
  g.href = gmapsUrl(route);
  g.hidden = false;
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
  el('poiList').innerHTML = poiCardsHtml(route.pois);
  attachCardNavigation('poiList');
}

function clearResults() {
  markers.forEach((m) => m.remove());
  markers = [];
  el('wanderResults').hidden = true;
  el('routeResults').hidden = true;
  el('wanderGmaps').hidden = true;
  el('routeGmaps').hidden = true;
}

loadCities();
