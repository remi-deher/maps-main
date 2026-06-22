# Suivi des améliorations UI/UX — GPS-Mock

Artefact de suivi vivant pour le chantier UI/UX transverse (iOS, web/desktop,
serveur). **Source de vérité** : on coche ici au fur et à mesure, statut fondé
sur le code vérifié (pas supposé). Mettre à jour à chaque commit.

Légende statut : ✅ fait · 🟡 partiel/à vérifier · ⬜ à faire · 🔎 audit requis

Dernière vérification du code : 2026-06-22 (commit de base `ce4bad0`).

---

## A. Client iOS (`ios-app/`)

Basé sur `docs/UI_UX_BASELINE.md` §4. Statut vérifié par inspection du code.

| # | Item | Statut | Preuve / note |
|---|---|---|---|
| 1 | Aucune `.shadow()` sur glass | ✅ | 0 fichier avec `.shadow(` |
| 2 | `GlassEffectContainer` autour des overlays | 🟡 | présent (`AdaptiveGlass.swift`) — auditer la couverture des clusters |
| 3 | Hit-targets ≥ 44 pt | ✅ | audit fait : seul `trailingButton` était à 32pt → porté à 44pt |
| 4a | `accessibilityLabel` sur boutons icône-seule | ✅ | audit fait : les contrôles utilisent `Label`/`Text`/`accessibilityLabel` (déjà accessibles) ; les 2 images décoratives (loupe, poignée) passées en `accessibilityHidden` |
| 5 | `AccentColor`, plus de `.indigo` codé en dur | ✅ | `.indigo` 0 hit, `accentColor` 18 hits, asset présent |
| 6 | Dynamic Type sémantique + `@ScaledMetric` | 🟡 | aucune `.font(.system(size:))` magique (bon) ; `@ScaledMetric` 0 → frames non scalés (polish) |
| 7 | `MKLocalSearchCompleter` (suggestions live) | ✅ | `SearchCompleter.swift`, 6 hits |
| 8 | Bandeau inline au lieu d'alerte « déconnecté » | ✅ | `statusBanner` présent ; 1 `.alert(` restant à vérifier (légitime ?) |
| 9 | String Catalog `.xcstrings` + localisation | ⬜ | aucun `.xcstrings` → strings codés en dur |
| 10 | Décomposer les sheets simultanées | ✅ | `SettingsSheet` en `NavigationStack` |
| 11 | Sortir la `List` itinéraire du `ScrollView` | ✅ | 0 `scrollDisabled` |
| 12 | Annotation simulée custom + `symbolEffect` | 🟡 | `symbolEffect` 1 hit — vérifier le marqueur position |
| 13 | `mapControls` (boussole / échelle / pitch) | ✅ | 3 hits |
| 14 | App Intents favoris (Siri/Raccourcis/Spotlight) | ⬜ | aucun `AppIntent` dans `Sources/` |
| 4b | Live Activity interactive (App Intents Pause/Stop) | ⬜ | aucun `AppIntent` → activité non interactive |
| 15 | `TipKit` long-press carte | ✅ | `MapLongPressTip.swift`, 4 hits |
| 16 | `Task.sleep` au lieu de `Timer` | ⬜ | 1 `Timer.scheduledTimer` restant |
| 17 | Slider vitesse + icônes Picker profil | 🟡 | à vérifier dans les panels |
| 18 | LogsView : `searchable` + filtre niveau | 🟡 | `searchable` présent ; filtre par niveau à vérifier |
| 19 | `reduceTransparency` fallback | ✅ | 3 hits |

**Reste à faire iOS (priorisé)** :
- ~~**A1 — Accessibilité**~~ ✅ fait : l'audit a montré que les contrôles étaient déjà accessibles (Label/Text/accessibilityLabel) ; corrigé le seul hit-target 32pt → 44pt et masqué 2 images décoratives. `@ScaledMetric` (#6) laissé en polish.
- **A2 — Quick wins** (#16 `Timer`→`Task.sleep`, #17 slider/picker, #2/#12 audit).
- **A3 — Localisation** (#9) : String Catalog `.xcstrings`.
- **A4 — App Intents** (#14 favoris, #4b Live Activity interactive Pause/Stop).

---

## B. Client web / desktop (`tauri-app/`)

⚠️ **Aucune analyse UX n'existe pour le web** (la baseline est 100 % iOS). Et le
web est désormais un produit à part entière (headless+web servi au navigateur).

| # | Item | Statut | Note |
|---|---|---|---|
| B0 | Rédiger `docs/UI_UX_BASELINE_WEB.md` (audit + roadmap) | ✅ | fait — audit sourcé + roadmap 10 items |
| B1 | Décomposer `Sidebar.tsx` (**1283 lignes**, god-component) | ⬜ | **vérifié** : 4 onglets (control/favs/route/settings), tout mêlé |
| B2 | Layout responsive (navigateur mobile/tablette) | ⬜ | **vérifié** : 1 seule `@media` dans tout le CSS → non responsive |
| B3 | Audit de parité avec iOS | ✅ | **vérifié** : patrouille, GPX, statut connexion présents côté web |
| B4 | États vides / erreurs / chargement cohérents | 🔎 | à auditer après B0 |
| B5 | Accessibilité web (aria, focus, contrastes) | 🟡 | `lang=fr`, `:focus-visible` global, `prefers-reduced-motion` faits ; SearchBox (résultats=boutons, listbox) + MapContainer (aria-label/aria-pressed) faits ; reste les `<div onClick>` du `Sidebar` (à traiter pendant la décompo B1) |

---

## C. Serveur / moteur (`engine/`)

« UX opérateur » — surface accrue depuis l'UI web embarquée.

| # | Item | Statut | Note |
|---|---|---|---|
| C1 | Page d'état / first-run dans l'UI web (driver, device, tunnel) | ⬜ | aujourd'hui implicite |
| C2 | Remonter `LOG`/`LOGS` proprement dans l'UI (toasts/bandeau) | ⬜ | au-delà de la console |
| C3 | Messages d'erreur actionnables (généraliser le fix tunnel pmd3) | 🟡 | fait pour pmd3 ; étendre |
| C4 | Observabilité (`/metrics`, health) | ✅ | déjà en place |

---

## Ordre d'exécution retenu

1. **A1 — Accessibilité iOS** (rapide, fort impact, faible risque) ← *on commence ici*
2. **A2 — Quick wins iOS**
3. **A3 — Localisation iOS** (String Catalog)
4. **A4 — App Intents iOS**
5. **B0 — Audit UX web** (doc), puis **B1–B5**
6. **C1–C3 — UX serveur** (first-run web, remontée d'erreurs)

Chaque étape = commit(s) isolé(s), CI verte sur push, ce tracker mis à jour.

---

## Journal

- 2026-06-22 — Création du tracker ; vérification de l'état réel iOS (base `ce4bad0`).
- 2026-06-22 — **A1 accessibilité iOS** : audit montre l'a11y déjà quasi complète (Label/Text/accessibilityLabel partout). Corrigé : `trailingButton` 32→44pt, loupe + poignée de réorganisation `accessibilityHidden`. Items #3, #4a ✅. (commit `1b48216`)
- 2026-06-22 — **A2 quick wins iOS** : vérifiés déjà faits (Timer→Task = commentaire seul ; Slider vitesse ; filtre niveau LogsView ; icônes Picker profil). Aucun code requis.
- 2026-06-22 — **B0 première vérif web** : Sidebar 1283 l./4 onglets (B1 confirmé) ; 1 seule `@media` → non responsive (B2) ; parité iOS OK (B3 ✅) ; 45 `onClick` sur `<div>` + 3 aria-label (B5 a11y, vrai trou). Reste à rédiger l'audit complet `UI_UX_BASELINE_WEB.md`.
- 2026-06-22 — **Web bloc 1–3 (a11y + robustesse)** : `lang=fr` + `:focus-visible` + `prefers-reduced-motion` (`64508cb`) ; SearchBox résultats→boutons/listbox + MapContainer aria (`4cad58a`) ; SearchBox `AbortController`/erreur + header UA retiré ; audit 3.3 corrigé (OSRM = server-side, CSP = phase serveur). Reste web : décompo Sidebar (B1) + divs Sidebar a11y, responsive (B2), favicon/empty-states.
- 2026-06-22 — **B0 audit web rédigé** (`docs/UI_UX_BASELINE_WEB.md`) : 12 écarts sourcés (3 critiques : `lang="en"`, `<div onClick>`, dépendances réseau/CSP+OSRM http), roadmap 10 items. Découvertes en plus : `lang="en"` vs app FR ; OSRM en `http://` (mixed-content) ; UA Nominatim ignoré en navigateur ; pas de `prefers-reduced-motion`/`prefers-color-scheme`. Ordre conseillé : a11y+robustesse navigateur (1–3) → décompo+responsive (4–5) → polish.
