# UI / UX Baseline — Client web / desktop (GPS-Mock)

Audit du frontend `tauri-app/` (React + Leaflet), pendant web de la baseline
iOS (`UI_UX_BASELINE.md`). Le même build sert deux produits :
- **desktop** : enveloppe native Tauri + moteur sidecar ;
- **headless + web** : servi par le moteur dans un navigateur (`http://localhost:8080`).

Statuts vérifiés dans le code le 2026-06-22 (base `5c25517`). Légende :
✅ fait · 🟡 partiel · ⬜ à faire · 🔎 à approfondir.

---

## 1. Portée et intention

Donner au client web la même rigueur UX que l'iOS, et le rendre **réellement
utilisable dans un navigateur** (le moteur l'expose désormais), y compris hors
de la fenêtre Tauri : accessibilité clavier/lecteur d'écran, responsive,
robustesse réseau/CSP, et maintenabilité du code.

---

## 2. Points forts existants — à préserver

- **Parité fonctionnelle avec iOS** : téléportation, itinéraire, séquences,
  favoris, **patrouille**, **import/export GPX**, statut moteur — tout est là.
- **Onglets et contrôles carte = vrais `<button>`** (`Sidebar.tsx` `tabs-nav`,
  `MapContainer.tsx` map-style / recentrage) : focusables et activables clavier.
- **Glassmorphism cohérent** et structure en 4 onglets (Contrôle / Favoris /
  Séquences / Réglages) lisible.
- **Reconnexion WebSocket automatique** + statut de connexion affiché
  (`État système` → Connecté / Reconnexion / Hors ligne).
- **Recherche debouncée** (600 ms) avec fermeture au clic extérieur (SearchBox).
- **Un breakpoint responsive** déjà présent (`@media (max-width: 760px)`).

---

## 3. Écarts à corriger

### 3.1 [CRITIQUE] `lang="en"` alors que l'app est en français
`index.html` déclare `<html lang="en">` mais toute l'UI est en français. Les
lecteurs d'écran appliquent les règles de prononciation anglaises. Fix XS :
`lang="fr"` (ou piloter dynamiquement plus tard pour l'i18n).

### 3.2 [CRITIQUE] Éléments interactifs non accessibles (`<div onClick>`)
**45 `onClick` sur des `<div>`** pour seulement **3 `aria-label`**. Exemple net,
le dropdown de recherche (`SearchBox.tsx`) :
```tsx
<div className="search-result-item" onClick={() => handleSelect(res)}> … </div>
```
→ non focusable au clavier, pas annoncé comme bouton, pas de navigation
flèches, pas de `role="listbox"/"option"`. Idem pour les listes (favoris,
historique, legs de séquence). C'est le principal trou d'accessibilité web.
**Action** : convertir en `<button>` (ou `role`+`tabIndex`+gestion clavier),
et ajouter `aria-label` aux boutons icône-seule.

### 3.3 [CRITIQUE] Dépendances réseau externes → CSP + offline (produit headless+web)
Appels **depuis le navigateur** (vérifié : un seul `fetch()` direct, + ressources statiques) :
- Google Fonts (`App.css`), Leaflet CSS via **unpkg** (`index.html`) ;
- tuiles : `tile.openstreetmap.org`, `basemaps.cartocdn.com`, `server.arcgisonline.com` ;
- géocodage **Nominatim** (`SearchBox.tsx`).

Note : **OSRM est appelé côté moteur** (server-side) ; le champ « Serveur OSRM »
de l'onglet Réglages ne fait que configurer l'URL utilisée par le moteur — donc
**pas de mixed-content navigateur** (le `http://…` dans le placeholder est sans effet sur la page).

Conséquences pour le moteur qui sert l'UI :
- la **CSP** du moteur doit autoriser ces hôtes (polices, unpkg, tuiles, Nominatim),
  sinon UI cassée en navigateur → **tâche serveur** (phase C) ;
- ✅ corrigé côté web : header `User-Agent` Nominatim (interdit/ignoré en navigateur) **retiré**,
  `AbortController` + état d'erreur ajoutés (`SearchBox.tsx`) ;
- **aucun fonctionnement hors-ligne** (polices/tuiles/CDN) — auto-héberger
  Leaflet/police plus tard si besoin.
**Action restante** : CSP explicite servie par le moteur (phase serveur C).

### 3.4 [MAJEUR] `Sidebar.tsx` — god-component de 1283 lignes
Connexion, télémétrie, favoris, séquences, patrouille, GPX, réglages : tout est
dans un seul composant. Difficile à maintenir/tester/faire évoluer.
**Action** : extraire un composant par onglet (`ControlTab`, `FavoritesTab`,
`SequencesTab`, `SettingsTab`) + sous-composants (cartes), état partagé via le
contexte existant.

### 3.5 [MAJEUR] Responsive limité à un seul breakpoint
`@media (max-width: 760px)` repositionne quelques éléments, mais la sidebar
reste un panneau de largeur fixe et les cartes denses passent mal sur mobile.
**Action** : repenser la sidebar en feuille/onglets adaptatifs sous ~760px,
tester 360–768 px.

### 3.6 [MAJEUR] Pas de `prefers-color-scheme` ni `prefers-reduced-motion`
Thème sombre figé (0 `prefers-color-scheme`) et animations non désactivables
(0 `prefers-reduced-motion`) → inconfort en mode clair et problème vestibulaire.
**Action** : fallback `prefers-reduced-motion: reduce` ; à terme, thème clair.

### 3.7 [MAJEUR] Sémantique ARIA des onglets + focus-visible
Les onglets sont des `<button>` (bien) mais sans `role="tab"`/`aria-selected`,
et le style focus est minimal (3 `:focus`, 0 `:focus-visible`).
**Action** : pattern ARIA tabs + `:focus-visible` net sur tous les interactifs.

### 3.8 [MINEUR] Boutons icône-seule sans `aria-label`
Ex. effacer la recherche (`X`), recentrer, styles de carte. **Action** :
`aria-label` explicite.

### 3.9 [MINEUR] SearchBox : pas d'`AbortController`, états vides/erreur muets
Le fetch n'est pas annulé (seulement le timeout), et une erreur réseau ne
s'affiche pas à l'utilisateur (console seulement).

### 3.10 [MINEUR] `index.html` : favicon/titre par défaut Vite
`favicon = vite.svg`. Cosmétique mais visible en onglet navigateur.

### 3.11 [POLISH] États vides / chargement cohérents
Uniformiser les empty-states et indicateurs de chargement (listes, séquences).

### 3.12 [POLISH] Remontée des erreurs moteur dans l'UI
Surfacer les events `LOG`/`LOGS` du moteur en toasts/bandeau (lié au volet
serveur C2 du tracker), au lieu de la seule console.

---

## 4. Roadmap d'amélioration — priorisation

| # | Étape | Effort | Impact | Réf |
|---|---|---|---|---|
| 1 | `lang="fr"` | XS | A11y/i18n | 3.1 |
| 2 | `<div onClick>` → `<button>`/role + aria-label + nav clavier dropdown | M | A11y critique | 3.2, 3.8 |
| 3 | CSP moteur explicite + OSRM en https + UA Nominatim correct | S | Robustesse headless+web | 3.3 |
| 4 | Décomposer `Sidebar.tsx` en composants par onglet | M | Maintenabilité | 3.4 |
| 5 | Responsive ≤760px (sidebar adaptative, test 360–768) | M | UX mobile | 3.5 |
| 6 | `prefers-reduced-motion` (+ thème clair plus tard) | S | A11y | 3.6 |
| 7 | ARIA tabs + `:focus-visible` global | S | A11y clavier | 3.7 |
| 8 | `AbortController` + états erreur/vide SearchBox | S | Robustesse | 3.9 |
| 9 | Favicon/titre propres | XS | Polish | 3.10 |
| 10 | Empty-states + remontée `LOG`/`LOGS` en toasts | M | UX | 3.11, 3.12 |

**Recommandation** : bloc 1–3 d'abord (a11y + robustesse navigateur, fort
impact) ; puis 4–5 (décompo + responsive) ; le reste en polish.

---

## 5. Règles d'or — checklist PR (web)

- [ ] Tout élément interactif est un `<button>`/`<a>` natif, ou a
      `role`+`tabIndex`+gestion clavier. Aucun `<div onClick>` nu.
- [ ] Tout bouton icône-seule a un `aria-label`.
- [ ] `:focus-visible` visible sur chaque interactif.
- [ ] Aucune nouvelle dépendance réseau externe sans entrée CSP correspondante
      ni fallback ; pas d'URL `http://` (mixed-content).
- [ ] Testé à 360 px, 768 px et desktop.
- [ ] Respecte `prefers-reduced-motion`.
- [ ] Pas d'ajout au god-component `Sidebar.tsx` : créer/éditer le composant
      d'onglet dédié.

---

## 6. Références

- Baseline iOS : `docs/UI_UX_BASELINE.md`
- Suivi transverse : `docs/UX_IMPROVEMENT_TRACKER.md`
- Architecture : `docs/ARCHITECTURE.md`
