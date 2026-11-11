# Détours — « Le trajet devient la visite »

Appli d'itinéraires qui inverse la logique des Maps classiques : au lieu du trajet le plus court, elle propose un trajet légèrement plus long mais plus intéressant, traversant des points d'intérêt (monuments, architecture, street art, nature, points de vue).

## État actuel — Prototype Phase 1

- Moteur de routage pondéré en JS pur (`src/engine.js`), testable sous Node et réutilisable dans le navigateur.
- Une ville = un fichier de données : `data/cities/paris.json` (24 POI). Ajouter une ville = ajouter un fichier JSON, **aucun changement de code**.
- PWA légère (`public/`) : carte MapLibre GL + tuiles vectorielles OpenFreeMap, saisie A/B, curseur « rapide ↔ intéressant », plafond de détour, filtres de catégories, profil du parcours (distance, durée, détour, score intérêt/détour) et fiches POI.
- Attribution OSM/ODbL, Wikipédia/Wikidata et Wikimedia Commons intégrée dès la conception.

## Parcours utilisateur

1. **Écran ville** : les villes disponibles sont listées automatiquement (`/api/cities` lit `data/cities/`). Ajouter une ville = déposer un JSON, elle apparaît sans aucun changement de code.
2. **Écran mode** : Flânerie (boucle) ou Itinéraire enrichi (A → B).
3. **Flânerie** : durée souhaitée + catégories de POI, **puis** point de départ → trois boucles proposées par secteur géographique (nord / est / ouest), cliquables.
4. **Itinéraire** : A, B, mode, curseur rapide↔intéressant, plafond de détour, catégories → tracé rue par rue + POI numérotés + fiches Wikipédia.

## Lancer

```bash
node server.mjs          # http://127.0.0.1:8080
npm test                 # tests du moteur de routage
```

## Logique d'optimisation (implémentée)

1. **Filtrage** des POI par ville et catégories choisies.
2. **Sélection de pivots** (2 à 6 selon la position du curseur) par ratio intérêt/coût, où le coût = détour à vol d'oiseau + pénalité propre au POI ; un budget de détour (plafond × distance directe) borne la sélection, et un seuil de proximité évite les POI redondants.
3. **Ordonnancement** des pivots par heuristique 2-opt (shortest path avec passages).
4. **Contrainte de détour maximal** : l'itinéraire ne dépasse jamais le plafond choisi (testé).
5. **Score affiché** : intérêt total par kilomètre, rapporté au détour, pour rendre l'arbitrage lisible.

## Mode flânerie (boucle)

Pas de destination : un point de départ, une durée souhaitée, et une boucle qui maximise les POI vus (`src/wander.js`). Budget distance = durée × vitesse ; insertion gloutonne des POI proches du départ (la boucle se construit en grappe), puis seconde passe par importance décroissante pour les POI plus lointains. Exemples réels (OSRM) : 3 h depuis la Tour Eiffel → 8 POI / 14 km ; 3 h depuis l'Hôtel de Ville → 12 POI / 15 km (cluster Marais).

## Fiches POI

Chaque POI porte un lien vers sa page Wikipédia (39/40 POI Paris) pour aller plus loin que la phrase de description.

## Routage rue par rue

La géométrie et les distances réelles viennent de l'API publique OSRM (`router.project-osrm.org`, profil `driving` du serveur démo : bonne approximation piétonne en milieu urbain dense, à remplacer par un profil `foot` self-hosted en phase 2). Le planificateur (`src/router.js`) :

1. Mesure le trajet direct réel (distance OSRM, plus fidèle que le vol d'oiseau).
2. Pré-sélectionne les pivots avec le moteur pondéré, puis demande la route rue par rue via les POI.
3. Si le détour réel dépasse le plafond, retire le POI le moins intéressant et réessaie, jusqu'au trajet direct en dernier recours.

## Limites connues du prototype (roadmap)

- Profil OSRM démo = voiture ; self-host avec profils `foot`/`bike` à prévoir, ainsi que la pénalité par arête modulée par la densité de POI du secteur.
- Géocodage : résolution par nom de POI connu ou coordonnées « lat, lon » ; Nominatim à brancher.
- Photos : un seul POI a une image Commons ; pipeline d'enrichissement Wikidata/Commons à construire.
- v2 : flânerie, guidage pas à pas, hors-ligne partiel. v3 : contenus communautaires, itinéraires thématiques.

## Ajouter une ville

Créer `data/cities/<id>.json` :

```json
{
  "id": "lyon",
  "name": "Lyon",
  "center": { "lat": 45.7640, "lon": 4.8357 },
  "defaultZoom": 13,
  "attribution": "...",
  "pois": [
    { "id": "...", "city": "lyon", "name": "...", "category": "monument",
      "lat": 0, "lon": 0, "interest": 0.8, "detourPenalty": 0.02,
      "description": "Une phrase.", "image": null }
  ]
}
```

Catégories supportées : `monument`, `architecture`, `street_art`, `nature`, `viewpoint`.

## Licences

Cartes et données © OpenStreetMap contributors (ODbL). Descriptions issues de Wikipédia/Wikidata (CC BY-SA). Photos Wikimedia Commons.
