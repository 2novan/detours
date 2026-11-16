import { CATEGORIES } from '../src/engine.js';
import { planRoute } from '../src/router.js';
import { planWanderVariants } from '../src/wander.js';
import { buildGpx, exportTargets } from '../src/export.js';

// ---------------------------------------------------------------------------
// Accessibilité : on respecte prefers-reduced-motion pour toutes les animations
// (flyTo, scrollIntoView) — on ne force jamais un mouvement animé.
// ---------------------------------------------------------------------------
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Libellés français des catégories de POI (affichage lisible, jamais le brut).
const CATEGORY_LABELS = {
  monument: 'Monument',
  architecture: 'Architecture',
  street_art: 'Street art',
  nature: 'Nature',
  viewpoint: 'Point de vue'
};

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

// ---------------------------------------------------------------------------
// Échappement / validation stricts : aucune donnée POI ou ville ne rentre dans
// un innerHTML. On construit le DOM avec createElement + textContent, et on ne
// garde en href/src que les URL dont le schéma est http(s).
// ---------------------------------------------------------------------------
function safeUrl(value) {
  if (typeof value !== 'string') return null;
  return /^https?:\/\//i.test(value.trim()) ? value.trim() : null;
}

// Affiche un message d'erreur inline dans l'écran formulaire courant
// (#formError, role='alert') — jamais d'alert() bloquante.
function showFormError(message, screenId) {
  const screen = el(screenId) ?? document.querySelector('.screen:not([hidden])');
  const box = screen?.querySelector('.formError');
  if (!box) return;
  box.textContent = message;
  box.hidden = false;
}

function clearFormError(screenId) {
  const screen = el(screenId) ?? document.querySelector('.screen:not([hidden])');
  const box = screen?.querySelector('.formError');
  if (!box) return;
  box.textContent = '';
  box.hidden = true;
}

async function loadCities() {
  const list = el('cityList');
  try {
    const res = await fetch('/api/cities');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const cities = await res.json();
    list.innerHTML = '';
    if (!Array.isArray(cities) || cities.length === 0) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = 'Aucune ville disponible pour le moment.';
      list.appendChild(p);
      return;
    }
    cities.forEach((c) => {
      const btn = document.createElement('button');
      btn.className = 'big';
      const strong = document.createElement('strong');
      strong.textContent = c.name;
      const span = document.createElement('span');
      span.textContent = `${c.poiCount} POI · flânerie et itinéraires enrichis`;
      btn.append(strong, document.createElement('br'), span);
      btn.addEventListener('click', () => selectCity(c.id));
      list.appendChild(btn);
    });
  } catch (err) {
    console.error(err);
    list.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'hint';
    p.setAttribute('role', 'alert');
    p.textContent = 'Impossible de charger la liste des villes. Vérifiez votre connexion puis rechargez la page.';
    list.appendChild(p);
  }
}

async function selectCity(id) {
  try {
    const res = await fetch(`/data/cities/${encodeURIComponent(id)}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state = { city: data, pois: data.pois };
    map.flyTo({ center: [data.center.lon, data.center.lat], zoom: data.defaultZoom ?? 13, animate: !REDUCED });
    el('cityName').textContent = data.name;
    el('wanderCityName').textContent = data.name;
    el('routeCityName').textContent = data.name;
    clearResults();
    showScreen('screen-mode');
  } catch (err) {
    console.error(err);
    showFormError('Impossible de charger cette ville — réessayez dans un instant.', 'screen-city');
  }
}

async function resolvePlace(input) {
  const raw = input.trim();
  // Entrée vide : on ne géocode pas, on rend null directement.
  if (!raw) return null;
  const coords = raw.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (coords) {
    const lat = parseFloat(coords[1]);
    const lon = parseFloat(coords[2]);
    // Plage valide des coordonnées géographiques.
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat, lon };
  }
  const poi = state.pois.find((p) => p.name.toLowerCase().includes(raw.toLowerCase()));
  if (poi) return { lat: poi.lat, lon: poi.lon };
  const query = state.city ? `${raw}, ${state.city.name}` : raw;
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=fr&q=${encodeURIComponent(query)}`,
    { signal: AbortController.timeout(8000) }
  );
  if (!res.ok) throw new Error('Géocodage indisponible (Nominatim) — réessayez dans un instant.');
  const results = await res.json();
  if (!Array.isArray(results) || results.length === 0) return null;
  const lat = parseFloat(results[0].lat);
  const lon = parseFloat(results[0].lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
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

// ---------------------------------------------------------------------------
// withBusy : en cas d'erreur, on affiche un message inline dans le panneau
// (#formError de l'écran courant, aria-live) — jamais d'alert().
// ---------------------------------------------------------------------------
async function withBusy(button, fn, screenId) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Calcul…';
  clearFormError(screenId);
  try {
    await fn();
  } catch (err) {
    console.error(err);
    showFormError('Erreur : ' + err.message, screenId);
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
}, 'screen-wander'));

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
}, 'screen-route'));

function renderVariants(variants) {
  el('wanderResults').hidden = false;
  const list = el('variantList');
  list.innerHTML = '';
  variants.forEach((v, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'variant' + (i === 0 ? ' selected' : '');
    btn.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
    const strong = document.createElement('strong');
    strong.textContent = v.label;
    const span = document.createElement('span');
    span.textContent = ` — ${v.pois.length} POI · ${(v.distance / 1000).toFixed(1)} km · ${Math.round(v.duration / 60)} min`;
    btn.append(strong, document.createElement('br'), span);
    btn.addEventListener('click', () => {
      list.querySelectorAll('.variant').forEach((b) => {
        b.classList.remove('selected');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('selected');
      btn.setAttribute('aria-pressed', 'true');
      renderWander(v);
    });
    list.appendChild(btn);
  });
}

function drawRoute(route) {
  const line = route.geometry.map((p) => [p.lon, p.lat]);
  setLine('route', line);
  if (!route.loop) setLine('direct', [line[0], line.at(-1)]);
  // Chaque layer est ajouté indépendamment : on ne dépend plus de l'ordre
  // d'ajout (bug où la 1ʳᵉ route affichait une boucle à cause du layer manquant).
  if (!map.getLayer('direct-line')) {
    map.addLayer({ id: 'direct-line', type: 'line', source: 'direct', paint: { 'line-color': '#999', 'line-dasharray': [2, 3], 'line-width': 2 } });
  }
  if (!map.getLayer('route-line')) {
    map.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': '#b3541e', 'line-width': 4 } });
  }
  markers.forEach((m) => m.remove());
  markers = route.pois.map((p, i) => {
    const btn = document.createElement('button');
    btn.className = 'poi-marker';
    btn.textContent = i + 1;
    btn.title = p.name;
    btn.setAttribute('aria-label', `POI ${i + 1} : ${p.name}`);
    btn.addEventListener('click', () => {
      const card = document.querySelector(`.poi-card[data-rank="${i + 1}"]`);
      if (card) {
        card.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'nearest' });
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
    },
    animate: !REDUCED
  });
}

function setLine(id, coordinates) {
  const data = { type: 'Feature', geometry: { type: 'LineString', coordinates } };
  if (map.getSource(id)) map.getSource(id).setData(data);
  else map.addSource(id, { type: 'geojson', data });
}

// ---------------------------------------------------------------------------
// Construction DOM des cartes POI : aucun innerHTML avec des données POI.
// name/description/category vont en textContent ; image et wikipedia ne sont
// posées en src/href que si l'URL est en http(s).
// ---------------------------------------------------------------------------
function buildPoiCard(p, i) {
  const li = document.createElement('li');
  li.className = 'poi-card';
  li.dataset.rank = String(i + 1);
  li.dataset.lat = String(p.lat);
  li.dataset.lon = String(p.lon);
  li.tabIndex = 0;
  li.setAttribute('role', 'button');
  li.setAttribute('aria-label', `Voir sur la carte : ${p.name}`);

  const imgUrl = safeUrl(p.image);
  if (imgUrl) {
    const img = document.createElement('img');
    img.src = imgUrl;
    img.alt = p.name;
    img.loading = 'lazy';
    li.appendChild(img);
  }
  const h3 = document.createElement('h3');
  h3.textContent = `${i + 1}. ${p.name}`;
  const cat = document.createElement('p');
  cat.className = `cat-${p.category}`;
  cat.textContent = CATEGORY_LABELS[p.category] ?? p.category;
  const desc = document.createElement('p');
  desc.textContent = p.description ?? '';
  li.append(h3, cat, desc);

  const wikiUrl = safeUrl(p.wikipedia);
  if (wikiUrl) {
    const a = document.createElement('a');
    a.className = 'wiki';
    a.href = wikiUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'En savoir plus — Wikipédia ↗';
    li.appendChild(a);
  }
  return li;
}

function renderPoiCards(listId, pois) {
  const list = el(listId);
  list.innerHTML = '';
  pois.forEach((p, i) => list.appendChild(buildPoiCard(p, i)));
  attachCardNavigation(listId);
}

function attachCardNavigation(listId) {
  document.querySelectorAll(`#${listId} .poi-card`).forEach((card) => {
    const fly = () => {
      map.flyTo({
        center: [parseFloat(card.dataset.lon), parseFloat(card.dataset.lat)],
        zoom: 16,
        animate: !REDUCED
      });
    };
    card.addEventListener('click', (e) => {
      if (e.target.closest('.wiki')) return;
      fly();
    });
    // Clavier : Entrée ou Espace déclenche le même flyTo (role='button').
    card.addEventListener('keydown', (e) => {
      if (e.target.closest('.wiki')) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fly();
      }
    });
  });
}

// --- Export multi-applis de l'itinéraire (Google Maps, Apple Plans, Waze, geo:, GPX) ---

// Conversion du mode de déplacement de l'UI ('walk'/'bike') vers le format
// attendu par les applis ('walking'/'bicycling'/'driving'). La flânerie est à pied.
const TRAVEL_MODES = { walk: 'walking', bike: 'bicycling', drive: 'driving' };

function travelModeFor(screen) {
  if (screen === 'wander') return 'walking';
  return TRAVEL_MODES[el('mode')?.value] ?? 'walking';
}

// Nom lisible de l'itinéraire, repris dans le GPX, l'URI geo: et le partage.
function exportName(route) {
  const city = state.city?.name ? ` — ${state.city.name}` : '';
  const base = route.label ?? (route.loop ? 'Boucle de flânerie' : 'Itinéraire enrichi');
  return `${base}${city}`;
}

function exportOpts(route, screen) {
  return {
    travelMode: travelModeFor(screen),
    cityName: state.city?.name,
    name: exportName(route)
  };
}

// Nom de fichier GPX : detours-<ville>.gpx (slugifié, jamais vide).
function gpxFileName() {
  const slug = (state.city?.id ?? 'itineraire')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `detours-${slug || 'itineraire'}.gpx`;
}

function buildExportBtnContent(icon, label, hint) {
  const iconSpan = document.createElement('span');
  iconSpan.className = 'export-icon';
  iconSpan.setAttribute('aria-hidden', 'true');
  iconSpan.textContent = icon;
  const textSpan = document.createElement('span');
  textSpan.className = 'export-text';
  const strong = document.createElement('strong');
  strong.textContent = label;
  textSpan.appendChild(strong);
  if (hint) {
    const small = document.createElement('small');
    small.textContent = hint;
    textSpan.appendChild(small);
  }
  return [iconSpan, textSpan];
}

/**
 * Remplit un bloc d'export (#wanderExport / #routeExport) : un lien par appli
 * (Google Maps, Apple Plans, Waze, geo:) + bouton de téléchargement GPX via Blob,
 * plus les actions « Copier le lien » et « Partager ».
 */
function renderExport(blockId, route, screen) {
  const block = el(blockId);
  const links = block.querySelector('.export-links');
  links.innerHTML = '';
  block.querySelector('.export-actions')?.remove();

  const opts = exportOpts(route, screen);
  const targets = exportTargets(route, opts);

  for (const target of targets) {
    if (target.kind !== 'download' && !target.href) continue; // pas de lien vide qui rechargerait la page
    if (target.kind === 'download') {
      // Cible GPX : téléchargement via Blob (le data: URI d'exportTargets sert de secours)
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'export-btn';
      btn.append(...buildExportBtnContent(target.icon, target.label, target.hint));
      btn.addEventListener('click', () => downloadGpx(route, opts));
      links.appendChild(btn);
    } else {
      const a = document.createElement('a');
      a.className = 'export-btn';
      a.href = target.href;
      // Pas de _blank sur un schéma geo: (Android) : le gestionnaire d'URI ne s'ouvre
      // pas dans un nouvel onglet, et un onglet vide resterait ouvert sur desktop.
      if (target.id !== 'geo') {
        a.target = '_blank';
        a.rel = 'noopener';
      }
      a.append(...buildExportBtnContent(target.icon, target.label, target.hint));
      links.appendChild(a);
    }
  }

  // Actions secondaires : copier le lien de l'itinéraire et partager la page.
  const shareUrl = targets.find((t) => t.id === 'google-maps')?.href || window.location.href;
  const actions = document.createElement('div');
  actions.className = 'export-actions';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'export-btn';
  copyBtn.append(...buildExportBtnContent('🔗', 'Copier le lien'));
  copyBtn.addEventListener('click', () => copyText(shareUrl, copyBtn));

  const shareBtn = document.createElement('button');
  shareBtn.type = 'button';
  shareBtn.className = 'export-btn';
  shareBtn.append(...buildExportBtnContent('↗️', 'Partager'));
  shareBtn.addEventListener('click', () => shareRoute(route, opts, shareUrl, shareBtn));

  actions.append(copyBtn, shareBtn);
  block.appendChild(actions);
  block.hidden = false;
}

// Téléchargement du GPX 1.1 via Blob + lien temporaire (fonctionne aussi hors-ligne).
function downloadGpx(route, opts) {
  const gpx = buildGpx(route, opts);
  const blob = new Blob([gpx], { type: 'application/gpx+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = gpxFileName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Copie dans le presse-papiers avec repli (clipboard API puis execCommand).
async function copyText(text, btn) {
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand('copy');
      ta.remove();
    } catch {
      ok = false;
    }
  }
  flashButton(btn, ok ? 'Copié ✓' : 'Copie impossible');
}

// Partage natif (Web Share API) ; repli sur la copie du lien si indisponible ou annulé.
async function shareRoute(route, opts, url, btn) {
  const payload = {
    title: `Détours — ${opts.name}`,
    text: `Itinéraire touristique : ${(route.distance / 1000).toFixed(1).replace('.', ',')} km, ${route.pois.length} POI sur le chemin.`,
    url
  };
  if (navigator.share) {
    try {
      await navigator.share(payload);
    } catch (err) {
      if (err?.name !== 'AbortError') copyText(url, btn);
    }
  } else {
    copyText(url, btn);
  }
}

// Retour visuel temporaire sur un bouton d'export (« Copié ✓ »…).
function flashButton(btn, message) {
  const label = btn.querySelector('.export-text strong');
  if (!label) return;
  label.setAttribute('aria-live', 'polite'); // annonce « Copié ✓ » aux lecteurs d'écran
  const old = label.textContent;
  label.textContent = message;
  btn.disabled = true;
  setTimeout(() => {
    label.textContent = old;
    btn.disabled = false;
  }, 1600);
}

// Construit une ligne <li> en DOM (textContent) — aucune donnée n'est
// injectée via innerHTML.
function statLi(...parts) {
  const li = document.createElement('li');
  parts.forEach((part, i) => {
    if (i > 0) li.appendChild(document.createTextNode(' '));
    if (typeof part === 'string') li.appendChild(document.createTextNode(part));
    else li.appendChild(part);
  });
  return li;
}

function strong(text) {
  const s = document.createElement('strong');
  s.textContent = text;
  return s;
}

function renderWander(route) {
  drawRoute(route);
  renderExport('wanderExport', route, 'wander');
  const profile = el('wanderProfile');
  profile.innerHTML = '';
  if (route.overBudget) {
    const ul = document.createElement('ul');
    const li = document.createElement('li');
    li.className = 'hint';
    li.append(
      strong('Durée dépassée.'),
      document.createElement('br'),
      document.createTextNode('La boucle la plus courte possible dépasse la durée demandée.')
    );
    ul.appendChild(li);
    profile.appendChild(ul);
  }
  renderPoiCards('wanderPoiList', route.pois);
}

function renderRoute(route) {
  drawRoute(route);
  renderExport('routeExport', route, 'route');
  const stats = el('stats');
  stats.innerHTML = '';
  stats.append(
    statLi(strong('Distance :'), `${(route.distance / 1000).toFixed(2)} km (direct : ${(route.directDistance / 1000).toFixed(2)} km)`),
    statLi(strong('Durée estimée :'), `${Math.round(route.duration / 60)} min`),
    statLi(strong('Détour :'), `+${Math.round(route.detour * 100)} %`),
    statLi(strong('POI :'), String(route.pois.length)),
    statLi(strong('Score intérêt / détour :'), route.score.toFixed(2))
  );
  if (route.pois.length === 0 && route.bestMissed) {
    const m = route.bestMissed;
    const li = document.createElement('li');
    li.className = 'hint';
    li.append(
      strong('Aucun POI dans le plafond de détour.'),
      document.createElement('br'),
      document.createTextNode(`Le plus accessible : ${m.poi.name} (+${Math.round(m.detour * 100)} % de détour).`),
      document.createElement('br'),
      document.createTextNode('Augmentez le curseur « Détour maximal » pour l\'inclure.')
    );
    stats.appendChild(li);
  } else if (route.pois.length === 0) {
    const li = document.createElement('li');
    li.className = 'hint';
    li.append(
      strong('Aucun POI sur ce trajet.'),
      document.createElement('br'),
      document.createTextNode('Essayez d\'autres catégories ou un itinéraire plus long.')
    );
    stats.appendChild(li);
  }
  renderPoiCards('poiList', route.pois);
}

function clearResults() {
  markers.forEach((m) => m.remove());
  markers = [];
  el('wanderResults').hidden = true;
  el('routeResults').hidden = true;
  // On vide aussi les tracés carte : plus de ligne fantôme après un changement
  // de ville ou de recherche.
  setLine('route', []);
  setLine('direct', []);
  // Cache aussi les blocs d'export et vide leurs liens/boutons (évite les écouteurs orphelins).
  for (const id of ['wanderExport', 'routeExport']) {
    const block = el(id);
    block.hidden = true;
    block.querySelector('.export-links').innerHTML = '';
    block.querySelector('.export-actions')?.remove();
  }
}

loadCities();

// ---------------------------------------------------------------------------
// Service worker : cache statique des assets (hors-ligne), network-first pour
// les données dynamiques (/api/, /data/). Voir sw.js.
// ---------------------------------------------------------------------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('Service worker non enregistré :', err);
    });
  });
}
