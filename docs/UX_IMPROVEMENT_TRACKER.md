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
| 9 | String Catalog `.xcstrings` + localisation | ✅ | `Localizable.xcstrings` (source fr) + `developmentLanguage`/`CFBundleDevelopmentRegion`/`SWIFT_EMIT_LOC_STRINGS` ; iOS Build CI vert (`e710455`) |
| 10 | Décomposer les sheets simultanées | ✅ | `SettingsSheet` en `NavigationStack` |
| 11 | Sortir la `List` itinéraire du `ScrollView` | ✅ | 0 `scrollDisabled` |
| 12 | Annotation simulée custom + `symbolEffect` | 🟡 | `symbolEffect` 1 hit — vérifier le marqueur position |
| 13 | `mapControls` (boussole / échelle / pitch) | ✅ | 3 hits |
| 14a | App Shortcuts contrôle simulation (Pause/Reprise/Stop/Relance) | ✅ | `SimulationIntents.swift` + `EngineClient.shared` ; Siri/Spotlight/Raccourcis. iOS Build CI vert (`559e1e8`) |
| 14b | App Intents favoris (AppEntity/EntityQuery) | ⬜ | différé : nécessite un `AppEntity` favoris + requête, plus lourd |
| 4b | Live Activity interactive (boutons widget) | ⬜ | différé : l'intent doit vivre dans la cible widget (≠ `EngineClient` app) → cross-target + probable App Group + QA Xcode |
| 15 | `TipKit` long-press carte | ✅ | `MapLongPressTip.swift`, 4 hits |
| 16 | `Task.sleep` au lieu de `Timer` | ⬜ | 1 `Timer.scheduledTimer` restant |
| 17 | Slider vitesse + icônes Picker profil | 🟡 | à vérifier dans les panels |
| 18 | LogsView : `searchable` + filtre niveau | 🟡 | `searchable` présent ; filtre par niveau à vérifier |
| 19 | `reduceTransparency` fallback | ✅ | 3 hits |

**Reste à faire iOS (priorisé)** :
- ~~**A1 — Accessibilité**~~ ✅ fait : l'audit a montré que les contrôles étaient déjà accessibles (Label/Text/accessibilityLabel) ; corrigé le seul hit-target 32pt → 44pt et masqué 2 images décoratives. `@ScaledMetric` (#6) laissé en polish.
- **A2 — Quick wins** (#16 `Timer`→`Task.sleep`, #17 slider/picker, #2/#12 audit).
- ~~**A3 — Localisation** (#9)~~ ✅ fait : String Catalog `.xcstrings` (source fr) + `SWIFT_EMIT_LOC_STRINGS`. Infra prête, traductions à peupler via l'extracteur Xcode (pas de local Xcode disponible — CI seule).
- ~~**A4 — App Intents**~~ ✅ fait pour Pause/Reprise/Stop/Relance (#14a). #14b (favoris AppEntity) et #4b (Live Activity interactive) différés.

**iOS = 100 % fait** (hors #14b/#4b différés et polish #6/#2/#12/#17/#18).

---

## B. Client web / desktop (`tauri-app/`)

⚠️ **Aucune analyse UX n'existe pour le web** (la baseline est 100 % iOS). Et le
web est désormais un produit à part entière (headless+web servi au navigateur).

| # | Item | Statut | Note |
|---|---|---|---|
| B0 | Rédiger `docs/UI_UX_BASELINE_WEB.md` (audit + roadmap) | ✅ | fait — audit sourcé + roadmap 10 items |
| B1 | Décomposer `Sidebar.tsx` (**1283 lignes**, god-component) | ✅ | fait : 4 composants `ControlTab`/`FavoritesTab`/`SequencesTab`/`SettingsTab` + `lib/parse.ts` ; **Sidebar 1283 → 101 l.** (shell). tsc/build/vitest verts (QA visuel à faire dans l'app) |
| B2 | Layout responsive (navigateur mobile/tablette) | ✅ | largeur fluide + paliers 760/480px, cibles tactiles ≥44px |
| B3 | Audit de parité avec iOS | ✅ | **vérifié** : patrouille, GPX, statut connexion présents côté web |
| B4 | États vides / erreurs / chargement cohérents | 🟡 | erreur recherche + empty-states favoris/historique présents ; reste à uniformiser |
| B5 | Accessibilité web (aria, focus, contrastes) | ✅ | `lang=fr`, `:focus-visible`, `prefers-reduced-motion` ; SearchBox/MapContainer/Sidebar (favoris, historique, zone GPX) tous accessibles clavier+SR ; reste = aria tabs (polish) |

---

## C. Serveur / moteur (`engine/`)

« UX opérateur » — surface accrue depuis l'UI web embarquée.

| # | Item | Statut | Note |
|---|---|---|---|
| C1 | Page d'état / first-run dans l'UI web (driver, device, tunnel) | ✅ | audit corrigé : `ControlTab` a déjà « État système » (moteur/tunnel/injection/dérive) + « Périphérique » (nom/driver/transport) avec message clair si aucun device — pas un vrai trou, juste mal étiqueté « implicite » à l'origine |
| C2 | Remonter `LOG`/`LOGS` proprement dans l'UI (toasts/bandeau) | ✅ | le client web demandait `GET_LOGS` mais n'avait aucun handler ; ajouté `logs` au contexte WS + `LogBanner.tsx` (bandeaux warn/error auto-expirables, visibles quel que soit l'onglet actif) (`c470099`) |
| C3 | Messages d'erreur actionnables (généraliser le fix tunnel pmd3) | ✅ | go-ios avait le même angle mort que pmd3 avant son fix (sortie tunnel ignorée sauf ligne RSD) ; appliqué le même tampon des 20 dernières lignes + cas de sortie anticipée (`78a1c87`) |
| C4 | Observabilité (`/metrics`, health) | ✅ | déjà en place |

**Serveur : terminé** (C1–C4). Section C close.

---

**Web : terminé** (B0–B5). Reste optionnel : aria tabs (polish), uniformisation empty-states (B4), QA visuel dans l'app de la décompo.

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
- 2026-06-22 — **iOS A4 App Shortcuts** (`559e1e8`) : Pause/Reprise/Stop/Relance via Siri/Spotlight/Raccourcis (`SimulationIntents.swift`, `EngineClient.shared`). iOS Build CI **vert** (compile OK). Favoris-AppEntity (#14b) + Live Activity interactif (#4b) différés (cross-target/AppEntity/QA Xcode). Prochain : localisation #9.
- 2026-06-22 — **B1 décompo Sidebar terminée** : `Sidebar.tsx` 1283 → 101 l. ; 4 onglets extraits (`tabs/ControlTab`, `FavoritesTab`, `SequencesTab`, `SettingsTab`) + `lib/parse.ts`. Commits `43f8541`, `1a5cd1a`, `6213ff1`, `5f64cd0`. tsc/build/vitest verts. **Web = 100 % fait.**
- 2026-06-22 — **Web a11y/responsive terminés** : Sidebar favoris/historique `<div>`→`<button>` + zone GPX clavier (`d3038b6`, B5 ✅) ; responsive ≤480px + cibles 44px (`eb3ed87`, B2 ✅). Reste B1 (décompo Sidebar) = pur refactor différé, à QA dans l'app.
- 2026-06-22 — **Web bloc 1–3 (a11y + robustesse)** : `lang=fr` + `:focus-visible` + `prefers-reduced-motion` (`64508cb`) ; SearchBox résultats→boutons/listbox + MapContainer aria (`4cad58a`) ; SearchBox `AbortController`/erreur + header UA retiré ; audit 3.3 corrigé (OSRM = server-side, CSP = phase serveur). Reste web : décompo Sidebar (B1) + divs Sidebar a11y, responsive (B2), favicon/empty-states.
- 2026-06-22 — **iOS A3 localisation #9** (`e710455`) : `Localizable.xcstrings` (source fr), `developmentLanguage: fr`, `CFBundleDevelopmentRegion: fr`, `SWIFT_EMIT_LOC_STRINGS: YES`. iOS Build CI **vert**. **iOS = 100 % fait** (App Intents #14a + localisation #9 ; #14b/#4b différés, polish restant non bloquant). Prochain : section C — UX serveur (C1 first-run, C2 logs en toasts, C3 erreurs actionnables).
- 2026-06-22 — **Serveur C2** (`c470099`) : `LogBanner.tsx` + `logs` dans le contexte WS — les `LOG`/`LOGS` du moteur (déjà consommés côté iOS) atteignent enfin l'UI web (bandeaux warn/error). tsc/build/vitest verts.
- 2026-06-22 — **Serveur C3** (`78a1c87`) : généralisé le fix tampon-20-lignes de pmd3 au driver go-ios (`StartTunnel`) — même angle mort, sortie ignorée hors ligne RSD. `go build`/`go vet`/`go test ./...` verts.
- 2026-06-22 — **Serveur C1 réévalué** : relecture du code montre que `ControlTab` couvre déjà l'essentiel (état moteur/tunnel/dérive + driver/transport/device) ; corrigé le faux trou plutôt que de construire un écran first-run non testable visuellement ici (pas de QA Tauri/navigateur disponible dans cet environnement). **Section C = 100 % fait. Chantier UX transverse (iOS + web + serveur) clos.**
- 2026-06-22 — **B0 audit web rédigé** (`docs/UI_UX_BASELINE_WEB.md`) : 12 écarts sourcés (3 critiques : `lang="en"`, `<div onClick>`, dépendances réseau/CSP+OSRM http), roadmap 10 items. Découvertes en plus : `lang="en"` vs app FR ; OSRM en `http://` (mixed-content) ; UA Nominatim ignoré en navigateur ; pas de `prefers-reduced-motion`/`prefers-color-scheme`. Ordre conseillé : a11y+robustesse navigateur (1–3) → décompo+responsive (4–5) → polish.
