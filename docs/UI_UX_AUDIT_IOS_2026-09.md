# Audit UI / UX — GPS-Mock Companion (iOS 26) — 2026-09-18

> Relecture complète de `ios-app/` (60 fichiers Swift, ~7 400 lignes) confrontée
> à l'architecture réelle de **Plans.app** et aux règles iOS 26 (Liquid Glass,
> HIG Layout/Accessibility, conditions MapKit).
>
> Complète — sans la remplacer — `docs/UI_UX_BASELINE.md` (référentiel de
> conception, dont la roadmap §4 est aujourd'hui traitée à ~90 %). Le tracker
> `docs/UX_IMPROVEMENT_TRACKER.md` annonce « iOS = 100 % fait » : c'est vrai
> pour la roadmap de juin 2026, mais la refonte bottom-sheet qui a suivi a
> introduit de nouveaux écarts, listés ici.
>
> **Limite de l'audit** : pas de macOS/Xcode disponible ici → audit statique du
> code et du packaging. Aucun rendu à l'écran, aucun profil Instruments, aucun
> passage VoiceOver réel. Les points marqués *(à vérifier sur device)* demandent
> une confirmation visuelle.

---

## 1. Comment Plans est réellement construit (modèle de référence)

Plans empile **trois couches, et trois seulement** :

| Couche | Contenu | Matériau |
|---|---|---|
| **Canvas** | la carte, plein écran, jamais masquée durablement | — |
| **Contrôles flottants** | boussole, échelle, localisation, calques, 3D | **Liquid Glass** (capsules/cercles, regroupés) |
| **Panneau persistant** | recherche, résultats, fiche lieu, itinéraire | sheet système + **contenu opaque** (listes groupées) |

Les règles structurantes qui en découlent :

1. **Le verre est réservé à la couche de contrôle flottante.** À l'intérieur de
   la sheet, Plans utilise des fonds `systemGroupedBackground` /
   `secondarySystemGroupedBackground` opaques. Jamais de verre sur du verre :
   Apple documente explicitement que Liquid Glass ne s'empile pas (le lensing se
   compose mal, le contraste s'effondre, le coût GPU double).
2. **La sheet ne disparaît jamais** et son contenu reste **scrollable à tous les
   détents**, pas seulement au plus grand.
3. **L'état système est toujours lisible** : Plans affiche en permanence
   l'indicateur de suivi, et bascule le header en bandeau quand quelque chose ne
   va pas (pas de réseau, pas de position).
4. **Une seule action par intention.** La recherche est *le* point d'entrée ; les
   favoris sont des raccourcis, pas des doublons de la recherche.
5. **L'attribution Apple (logo + « Légal ») reste visible** — c'est une
   obligation des conditions MapKit, pas un détail esthétique.

C'est sur ces cinq axes que l'app diverge aujourd'hui.

---

## 2. Ce qui est déjà juste (à ne pas casser)

- Sheet persistante native (`.sheet` + `presentationDetents` +
  `presentationBackgroundInteraction` + `interactiveDismissDisabled`) : c'est
  bien le pattern Plans, pas un composant maison.
- `MKLocalSearchCompleter` + surlignage des fragments saisis
  (`titleHighlightRanges`) — exactement le rendu Plans.
- `SpoofedLocationMarker` (anneau pulsé, pas de `Marker` étiqueté) qui reste
  distinguable du point bleu système même à dérive nulle.
- `LookAroundPreview` dans la fiche lieu, distance « à X km », adresse géocodée
  plutôt que des lat/lon bruts.
- `adaptiveGlassEffect` avec repli opaque sur `accessibilityReduceTransparency`.
- Haptique (`sensoryFeedback`) sur toutes les actions confirmées, `TipKit` pour
  le long-press, `ContentUnavailableView` sur les états vides.
- Mode de suivi cyclique (off → suivi → cap) avec une icône honnête.

---

## 3. Écarts à corriger

### P0 — bloquants (visibles dès l'installation ou en usage nominal)

#### P0-1 · L'app n'a pas d'icône

`ios-app/Sources/Assets.xcassets/AppIcon.appiconset/Contents.json` déclare un
slot 1024×1024 **sans `filename`**, et aucun PNG n'existe dans le dépôt.
Conséquence : icône blanche générique sur l'écran d'accueil, dans AltStore, dans
le sélecteur d'apps et dans les réglages iOS. C'est le tout premier contact avec
le produit.

**Fix** : produire l'icône via **Icon Composer** (Xcode 26) et livrer les trois
apparences iOS 26 — **claire / sombre / teintée** — plutôt qu'un seul PNG à plat.

#### P0-2 · Douze chaînes sans accents sur l'écran le plus visible

`BottomSheetActiveRouteControlsView.swift` : « Itineraire en cours », « Duree »,
« arrets », « Ajouter un arret », « Arreter », « Details », « Reglages »,
« Deplacement automatique », « Reprendre ou arreter le parcours », et
`accessibilityLabel("Details de l'itineraire")` (l. 47, 61, 64, 136, 253, 307,
320, 323, 354, 379, 404, 411). Même chose côté moteur dans
`EngineClient.swift:483-484` (« Non connecte au moteur - action ignoree »).
C'est l'écran affiché pendant toute la durée d'une simulation — le plus regardé
de l'app.

**Fix** : réaccentuer, puis ajouter un garde-fou CI (`grep -nE` sur les mots
fréquents, ou une `custom_rules` SwiftLint) pour que ça ne revienne pas.

#### P0-3 · Le contenu est inatteignable au détent `medium`

`BottomSheet.swift:127` — `.scrollDisabled(sheetDetent != .large)`. Au détent
medium (43 % de l'écran, soit ~360 pt sur un iPhone 17, moins 66 pt de header),
il reste ~290 pt utiles. Or :

- la `PlaceCard` fait ~500 pt (titre + Look Around 168 pt + carte de détails +
  deux rangées d'actions) → **la rangée « Favori / Ajouter une étape / … » est
  coupée et non atteignable** ;
- la liste de suggestions monte à 10 résultats → **5 visibles, les autres
  inaccessibles**.

Et c'est précisément à `medium` que l'app amène l'utilisateur : `ContentView`
force `sheetDetent = .medium` à la frappe (l. 171-184), à la sélection d'un lieu
(l. 198), à l'ajout d'une étape, au chargement d'un GPX.

**Fix** : autoriser le scroll à `medium` aussi (Plans le fait). Le verrou n'est
utile qu'au détent `collapsed`.

#### P0-4 · Aucun état de connexion sur l'écran principal, et des actions qui échouent en silence

`MapCoordinator.requireConnection()` renvoie `false` et les actions
(`teleportSelectedPlace`, `favoriteSelectedPlace`, `launchItinerary`,
`startRoute`) font un `return` **muet**. `engine.lastError` n'est affiché que
dans Réglages → Connexion (`SettingsSheet+Screens.swift:84`). Le bandeau inline
prévu par la baseline §3.9 — coché ✅ dans le tracker — **n'existe plus dans le
code** après la refonte bottom-sheet.

Résultat : moteur coupé → on tape « Positionner ici » → **il ne se passe
strictement rien**, sans un mot d'explication.

**Fix** :

1. Un bandeau persistant en tête de sheet quand `engine.state != .connected`
   (« Moteur non connecté » + bouton « Connecter »), à la Plans quand le réseau
   tombe.
2. Une pastille d'état discrète dans le header collapsed (le bouton rond
   Réglages peut porter un badge de couleur).
3. Toute action bloquée doit produire un retour (bandeau +
   `sensoryFeedback(.error)`), jamais un no-op.

#### P0-5 · Attribution Apple masquée par la sheet

`EngineMapView` est en `.ignoresSafeArea()` et la sheet couvre en permanence 43 à
92 % du bas de l'écran : le logo Apple et le lien « Légal » que MapKit pose en bas
à gauche sont **toujours recouverts**. C'est une obligation contractuelle MapKit,
pas un choix de mise en page (et `MapScaleView` subit le même sort).

**Fix** : réserver la zone basse au moteur de carte —
`.safeAreaInset(edge: .bottom)` correspondant à la hauteur du détent au repos, ou
un inset de contenu, pour que l'attribution remonte au-dessus de la sheet.

---

### P1 — conformité iOS 26 / Liquid Glass / accessibilité

#### P1-1 · Verre empilé sur verre (26 sites de verre, 1 seul `GlassEffectContainer`)

Le verre a débordé de la couche flottante vers **le contenu de la sheet** :
`PlaceCard` est une carte de verre (l. 62) qui contient elle-même une carte de
verre (`placeDetailsCard`) et une barre d'actions de verre
(`contextualActionBar`), le tout **posé sur le matériau de la sheet système**.
Idem `BottomSheetHomeView` (liste favoris, listes groupées),
`BottomSheetSearchResultsView`, `PatrolPanel`, `GpxPanel`,
`BottomSheetActiveRouteControlsView`. Seul `ContentView+MapChrome.swift:56`
utilise un `GlassEffectContainer` — et c'est le seul endroit où le verre est
légitime (contrôles flottants au-dessus de la carte).

**Fix** : le verre s'arrête à la couche flottante (omnibar, bouton rond, 2D/3D,
calques, recentrage, dock de contrôles de trajet). Dans la sheet, revenir à des
fonds groupés opaques. Gain immédiat : contraste, lisibilité en mode sombre sur
carte satellite, coût GPU.

#### P1-2 · Mauvais jeton de fond pour les cartes de contenu

`Color(.secondarySystemFill)` sert de fond à des surfaces entières
(`BottomSheetHomeView` ×5, `BottomSheetActiveRouteControlsView` ×3,
`ItineraryPanel` ×2, `PlaceCard`, `BottomSheetSearchResultsView`). Les couleurs
`*SystemFill` sont conçues pour de **petits contrôles** (jauges, pastilles), pas
pour des conteneurs. Le bon jeton est `secondarySystemGroupedBackground`.

#### P1-3 · Dynamic Type cassé dans `ItineraryPanel`

Quatre `.font(.system(size:))` en dur (l. 64, 91, 121, 137), dont du **10 pt**
(l. 121, l'estimation temps/distance de chaque tronçon) — sous le plancher
lisible HIG et insensible aux réglages d'accessibilité. Les pastilles d'étape
sont figées à 22×22 pt (l. 92, 138, 146) : à l'échelle AX5 le texte déborde.
C'est la seule vue restée hors de la passe `@ScaledMetric` (faite ailleurs :
`BottomSheetHomeView`, `PlaceCard`, `BottomSheetActiveRouteControlsView`).

#### P1-4 · Cibles tactiles sous 44 pt

`ItineraryPanel.swift:175` — bouton « supprimer une étape » en 34×34 ; l. 170 —
la poignée de réorganisation en 44×34. Règle HIG : 44×44 minimum,
`.contentShape()` si le visuel doit rester plus petit.

#### P1-5 · `Picker` segmenté d'images sans libellé accessible

`ItineraryPanel.swift:73-79` : `Image(systemName: "car.fill").tag("driving")` —
VoiceOver n'annonce rien d'exploitable, et la largeur est figée à 100 pt.

**Fix** : `Label("Voiture", systemImage: "car.fill").labelStyle(.iconOnly)` (le
texte survit pour VoiceOver) ou un `.accessibilityLabel` par segment.

#### P1-6 · Réorganisation d'étapes sans alternative accessible

Le reorder passe par `.onDrag` / `.onDrop` (`ItineraryPanel.swift:47-57`) :
aucun équivalent VoiceOver/Switch Control (`accessibilityAction(named:)`), et le
drag d'une ligne cohabite avec le drag de la sheet elle-même — conflit gestuel
probable *(à vérifier sur device)*.

#### P1-7 · Live Activity en retard d'une génération

`Widgets/SimulationActivityWidget.swift` : affichage seul, `.indigo` codé en dur
(la cible widget n'hérite pas de l'`AccentColor` de l'app), glyphes texte « ▶ » /
« II » en `compactTrailing` au lieu de SF Symbols, et **aucun `widgetURL`/deep
link** alors que le commentaire d'en-tête affirme le contraire. Depuis iOS 17 une
Live Activity accepte des `Button(intent:)` ; les intents Pause/Reprise/Stop
existent déjà (`SimulationIntents.swift`) — il reste à les rendre atteignables
depuis la cible widget (App Group + cible partagée).

#### P1-8 · String Catalog vide

`Sources/Localizable.xcstrings` contient **zéro chaîne** (73 octets). L'infra est
là (`developmentLanguage: fr`, `SWIFT_EMIT_LOC_STRINGS`), mais rien n'a jamais
été extrait ni commité : impossible de relire les libellés hors du code (c'est
d'ailleurs comme ça que P0-2 est passé), et pas de pluriels corrects (« 1 arrêt »
/ « 2 arrêts » restent bricolés par interpolation).

#### P1-9 · API dépréciée : `onChange(of:perform:)`

8 sites (`ContentView` ×4, `GpsMockCompanionApp`, `SettingsSheet` ×2,
`SettingsSheet+Screens`). Forme dépréciée depuis iOS 17 ; le reste du code
utilise déjà la forme moderne — uniformiser avant qu'un SDK la retire.

---

### P2 — UX produit et parité Plans

#### P2-1 · Quatre chemins pour la même action dans la sheet d'accueil

Le champ de recherche est en haut ; en dessous `BottomSheetHomeView` propose
**« Ajouter » (action rapide)**, **« + » (en-tête Lieux)**, **la carte « Aucun
favori »** et **« Rechercher ou ajouter un lieu » (section Plus)** — les quatre
appellent `focusSearchForAddition()`. Plans n'a qu'un point d'entrée : le champ.

**Fix** : ne garder que l'affordance contextuelle (la carte d'état vide) et
supprimer les trois autres.

#### P2-2 · Hiérarchie des actions rapides à l'envers

« Parcours GPX » est l'action **primaire** (pastille pleine accent). Or l'usage
nominal est : chercher un lieu → s'y positionner. Plans met en tête de sheet les
**favoris** (Maison / Travail). Ici les favoris sont relégués en dessous, avec un
géocodage asynchrone. Inverser : rangée de pastilles favoris en premier, GPX et
Patrouille en actions secondaires.

#### P2-3 · La recherche perd la requête

`submitSearch` et `selectSearchSuggestion` font `searchQuery = ""` avant même de
résoudre (`MapCoordinator+Search.swift:16, 27, 38`). Après une recherche, le
champ est vide : impossible d'affiner sa saisie ni de revenir à la liste des
résultats. Plans conserve le texte et le jeu de résultats.

Par ailleurs `ContentView:182` n'ouvre la sheet qu'à `.medium` pendant la frappe
alors que le commentaire cite Plans — qui va en **grand** pour montrer la liste
complète (cf. P0-3).

#### P2-4 · Clavier difficile à refermer

`.onTapGesture` sur `Map` étant cassé en iOS 26 (régression documentée dans le
code), toucher la carte ne ferme pas le clavier ; `scrollDismissesKeyboard` ne
sert à rien puisque le scroll est désactivé à `medium` (P0-3) ; et la barre
`ToolbarItemGroup(placement: .keyboard)` avec « Terminé » est déclarée sur
`ContentView` (l. 99) alors que le champ vit dans **la sheet**, une présentation
distincte — elle n'a donc probablement aucun effet *(à vérifier sur device)*. Il
reste la croix du header, seul moyen fiable.

#### P2-5 · Trois demandes de permission empilées au premier lancement

`ContentView.onAppear` (l. 107-109) déclenche localisation **et** notifications,
pendant que `discovery.start()` déclenche l'alerte « réseau local ». Trois popups
système d'affilée, sans contexte. Or le maintien en arrière-plan exige
« Toujours » — un refus initial condamne la fonction principale.

**Fix** : un court écran de première ouverture (ou une carte dans la sheet) qui
explique *pourquoi*, puis une demande à la fois, déclenchée au moment où la
fonction est réellement utilisée.

#### P2-6 · Géocodage inverse par ligne, sans état d'échec

`BottomSheetHomeView.resolveAddress` lance un `CLGeocoder` **par favori et par
récent** (jusqu'à 15 requêtes au déploiement de la sheet). CoreLocation throttle
agressivement ; en cas d'échec ou hors-ligne, la ligne reste indéfiniment sur le
placeholder masqué « Adresse… », sans repli ni message.

**Fix** : stocker l'adresse au moment de l'enregistrement du favori/récent (elle
est déjà connue : `SelectedPlace.subtitle`), ne géocoder qu'en dernier recours,
et prévoir un repli lisible.

#### P2-7 · Pas d'indicateur permanent « position simulée active »

`SimulationControlBarView` ne s'affiche que pour les états `moving`/`paused`.
Après une téléportation simple (état `ready`), **rien** à l'écran ne dit qu'une
position est injectée, ni de combien elle dérive — alors que c'est la promesse
centrale du produit. Seul le marqueur pulsé sur la carte en témoigne, et il peut
être hors du cadre.

#### P2-8 · Fiche lieu : impasses mineures

Le bouton Favori se **désactive** une fois le lieu ajouté (`PlaceCard:213`) — pas
de retrait, alors que la suppression existe (menu contextuel dans la liste).
« Copier les coordonnées » ne produit aucun retour visible.

#### P2-9 · Portrait verrouillé

`project.yml` n'autorise que `UIInterfaceOrientationPortrait`. Pour une app
carte, le paysage est un usage attendu (et l'iPad reste dans la famille de cibles
par défaut). Choix légitime pour une app perso, mais à assumer explicitement.

#### P2-10 · Documentation désynchronisée

`ios-app/README.md` décrit encore `OmniBar.swift` et `SuggestionsPanel.swift`,
supprimés depuis la refonte bottom-sheet. `UX_IMPROVEMENT_TRACKER.md` affirme
« iOS = 100 % fait » et coche ✅ le bandeau de connexion (P0-4) qui n'existe plus.

---

## 4. Plan d'action proposé

| Lot | Contenu | Effort | Risque |
|---|---|---|---|
| **1 — Rattrapage immédiat** | P0-1 icône (Icon Composer, 3 apparences) · P0-2 accents + garde-fou CI · P0-3 scroll à `medium` · P1-9 `onChange` | S | Nul |
| **2 — Honnêteté d'état** | P0-4 bandeau de connexion + retour d'échec sur action bloquée · P2-7 indicateur « position injectée » · P0-5 attribution MapKit | M | Faible |
| **3 — Passe Liquid Glass** | P1-1 sortir le verre de la sheet · P1-2 jetons de fond · P1-3/4/5/6 Dynamic Type + cibles + a11y `ItineraryPanel` | M | Visuel — à QA sur device |
| **4 — Parité Plans** | P2-1 dédoublonner · P2-2 favoris en tête · P2-3 conserver la requête · P2-4 fermeture clavier · P2-6 adresses stockées | M | Faible |
| **5 — Différé** | P1-7 Live Activity interactive · P1-8 extraction String Catalog · P2-5 onboarding permissions · P2-9 paysage | L | Nécessite Xcode local |

**Ordre conseillé** : lot 1 en un seul commit (aucun risque, gain immédiat et
visible), puis lot 2 — c'est le trou fonctionnel le plus coûteux à l'usage —,
puis 3 et 4.

---

## 5. Notes de packaging (`.ipa`)

- Build CI **non signé** volontairement (AltStore re-signe) — cohérent, rien à
  changer.
- Pas de `PrivacyInfo.xcprivacy` : sans objet pour une distribution AltStore, à
  ajouter si une soumission App Store devenait un jour envisagée (l'app utilise
  `UserDefaults` et la localisation, deux catégories à déclarer).
- `UIBackgroundModes: location` + `fetch`, `BGTaskSchedulerPermittedIdentifiers`
  et les quatre `NS*UsageDescription` sont présents et motivés — conforme.
- `SWIFT_VERSION: "5.0"` cohabite avec `@Observable` et une isolation
  `@MainActor` stricte : ça compile, mais un passage en mode langage Swift 6
  révélerait probablement des avertissements de concurrence à traiter un jour.

---

## 6. État d'avancement (mise à jour 2026-09-18)

Tout ce qui est réalisable sans macOS/Xcode a été appliqué dans la foulée de
l'audit. **Rien n'a pu être compilé ni vu à l'écran depuis cet environnement
(Windows)** : la vérification passe par la CI iOS (`ios-build-ci.yml`), puis par
une relecture visuelle sur appareil.

| # | Statut | Ce qui a été fait |
|---|---|---|
| P0-1 | ✅ | Icône générée (`Scripts/generate_app_icon.py`) en trois apparences — claire opaque, sombre et teintée à fond transparent — et `Contents.json` mis à jour. |
| P0-2 | ✅ | 12 chaînes réaccentuées + `EngineClient`. Garde-fou `Scripts/check_french_strings.py` branché en première étape de la CI iOS. |
| P0-3 | ✅ | `scrollDisabled(isCollapsed)` : le contenu scrolle à `medium` comme à `large`. |
| P0-4 | ✅ | `BottomSheetStatusBannerView` : bandeau « Moteur non connecté » + bouton Connecter, pastille d'alerte sur le bouton rond au détent collapsed, `sensoryFeedback(.error)` et dépliage de la sheet quand une action est refusée. |
| P0-5 | ✅ | `EngineMapView.sheetCoverage` → `safeAreaInset(edge: .bottom)` sur la `Map` : attribution Apple, boussole et échelle remontent au-dessus de la sheet. |
| P1-1 | ✅ | Verre sorti de la sheet. `AdaptiveGlass.swift` remplacé par `SheetCardBackground.swift` (`sheetCardBackground` / `sheetInnerBackground`), styles de boutons `.glass*` → `.bordered*` à l'intérieur du panneau. Le verre ne subsiste que sur les contrôles flottants au-dessus de la carte. |
| P1-2 | ✅ | Cartes en `secondarySystemGroupedBackground`, sous-blocs en `tertiarySystemFill`. |
| P1-3 | ✅ | `ItineraryPanel` : plus aucune `.font(.system(size:))`, pastilles et cibles en `@ScaledMetric`. |
| P1-4 | ✅ | Supprimer/poignée portés à 44 pt. |
| P1-5 | ✅ | `Picker` de profil en `Label(...).labelStyle(.iconOnly)`, largeur minimale au lieu de figée. |
| P1-6 | ✅ | Actions d'accessibilité « Monter / Descendre / Supprimer » sur chaque étape. |
| P1-7 | 🟡 | Teinte, symboles SF et `widgetURL` (schéma `gpsmock://`, traité par `onOpenURL`) faits ; catalogue d'assets propre à la cible widget. **Boutons interactifs différés** : ils imposent un App Group et un client moteur partagé entre les deux cibles, non testable ici. |
| P1-8 | ⬜ | Le String Catalog ne peut être peuplé que par l'extracteur Xcode au build (`SWIFT_EMIT_LOC_STRINGS`). À faire sur un Mac ; le garde-fou accents couvre le risque principal en attendant. |
| P1-9 | ✅ | Les 20 `onChange` migrés vers la forme à deux paramètres. |
| P2-1 | ✅ | Trois des quatre entrées vers la recherche supprimées ; seule la carte d'état vide subsiste. |
| P2-2 | ✅ | Favoris en tête de sheet, GPX et Patrouille en actions secondaires (plus de pastille pleine sur GPX). |
| P2-3 | ✅ | La requête est conservée (remplacée par l'entrée choisie) au lieu d'être effacée. |
| P2-4 | ✅ | Barre « Terminé » déplacée sur le contenu de la sheet, où elle s'attache vraiment ; le scroll rétabli à `medium` rend `scrollDismissesKeyboard` opérant ; le clavier se ferme aussi à la sélection d'une suggestion. |
| P2-5 | ✅ | `FirstRunPrimerCard` : les trois autorisations sont expliquées, et aucune alerte système n'est déclenchée avant le tap sur « Continuer ». |
| P2-6 | ✅ | `AddressResolver` : une requête à la fois, cache mémoire + disque partagé, repli lisible sur les coordonnées en cas d'échec. |
| P2-7 | ✅ | Bandeau « Position simulée active » avec nom du lieu et dérive, hors états couverts par un bandeau dédié. |
| P2-8 | ✅ | Bouton favori bascule (ajout/retrait) au lieu de se désactiver ; confirmation « Coordonnées copiées ». |
| P2-9 | ⬜ | Portrait conservé : passer en paysage demande de repenser les détents de la sheet, non vérifiable sans appareil. |
| P2-10 | ✅ | `ios-app/README.md`, `docs/BOTTOM_SHEET_AI_GUIDE.md` et le tracker remis en phase. |

**Trouvé en cours de route** : `ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME`
n'était posé sur aucune des deux cibles. L'`AccentColor` du catalogue était donc
compilé mais jamais désigné comme teinte globale — tous les `Color.accentColor`
de l'app tombaient sur le bleu système au lieu de l'indigo prévu. Corrigé dans
`project.yml` pour l'app et pour le widget. Les templates Xcode posent ce
réglage, XcodeGen non.

**À vérifier sur appareil** en priorité : le rendu de la sheet sans verre en
mode sombre sur fond satellite, la position de l'attribution Apple aux trois
détents, la barre « Terminé », et le conflit éventuel entre le glisser-déposer
d'une étape et le drag de la sheet.

---

## 7. Passe 2 — rapprochement de Plans (2026-09-19)

Seconde passe, demandée après l'audit : tout sauf le **mode navigation** (caméra
suiveuse, tracé consommé, progression moteur, heure d'arrivée), laissé de côté
volontairement.

### 7.1 Grammaire de la fiche lieu

- `PlaceCard` : les deux rangées de capsules pleine largeur sont devenues **une
  rangée horizontale de boutons ronds** (Positionner · Itinéraire · Étape ·
  Favori · Partager · Copier) — la signature visuelle de la fiche Plans.
- Le **titre et la croix migrent dans le header de la sheet**
  (`BottomSheetHeaderView.placeHeader`) : sélectionner un lieu remplace le champ
  de recherche par le nom du lieu, comme Plans. Plus de titre en double, et le
  nom reste lisible au détent replié, là où la carte n'est pas rendue.
- Ligne d'identité « **Restaurant · à 2,3 km** » sous le titre, avec un
  **pager « 2 sur 7 »** pour passer d'un résultat à l'autre sans revenir à la
  liste.
- `ShareLink` (lien `maps.apple.com` partageable) et **Look Around plein écran**
  au tap sur la vignette (`lookAroundViewer`).

### 7.2 Catégories de lieux

`PointOfInterestStyle` mappe ~40 `MKPointOfInterestCategory` vers un libellé
français, un symbole SF et une couleur (restauration orange, transports bleus,
nature verte…). Sert à trois endroits : le libellé de la fiche, l'icône du
header, et les **épingles de carte colorées par catégorie** — Plans ne pose pas
des repères rouges identiques partout.

### 7.3 Caméra pilotée par la sheet

Le décalage `0,32` codé en dur de `focus(on:)` — juste au détent `medium`, faux
ailleurs — est remplacé par un calcul dérivé de `MapCoordinator.sheetCoverage`,
qui est aussi ce qui alimente la safe area basse de la `Map`. `boundingRegion`
dilate en plus la hauteur de région pour qu'un trajet cadré tienne entièrement
dans la bande visible au lieu de passer à cheval sur la sheet.

### 7.4 Recherche

- **Puces de catégories** (`SearchCategoryChipsView`) dès que le champ est actif
  et vide : Restaurants, Stations-service, Parkings, Pharmacies…
- **« Rechercher dans cette zone »** : capsule flottante en haut de carte, qui
  apparaît quand la carte s'est éloignée de plus de 35 % de la hauteur visible
  du cadrage de la dernière recherche, et relance la requête **sans bouger la
  caméra**.
- Épingles colorées par catégorie (cf. 7.2), la sélectionnée agrandie avec
  anneau blanc et ombre.

### 7.5 Alternatives de trajet — et pourquoi elles sont réelles

OSRM est désormais interrogé avec `alternatives=true` (`OSRMClient.fetchRoutes`)
pour une destination unique. Les variantes s'empilent sous la destination (« Le
plus rapide », « +4 min »), les non retenues sont tracées en gris sur la carte.

**Le point délicat** : `domain.RouteLeg` ne transporte que `start`/`end`/`speed`
— le moteur recalcule la route lui-même. Afficher un choix de tracés sans plus
aurait été un mensonge : la simulation aurait suivi l'itinéraire par défaut quoi
qu'on choisisse. `viaPointForSelectedAlternative` résout ça en injectant, **au
lancement uniquement**, un point de passage pris là où la variante retenue
s'écarte le plus du tracé rapide (seuil : 150 m). Le moteur route alors
début → point de passage → destination et emprunte bien la variante. Le point de
passage n'existe que dans la séquence envoyée au moteur ; la liste d'étapes
affichée reste celle de l'utilisateur.

### 7.6 Petites pièces

- **Trafic** : bascule dans le menu calques (là où Plans la met), `showsTraffic`
  sur `MapStyle.standard`/`.hybrid`.
- **Tap sur la carte** : ferme la fiche, sinon replie la sheet. Le tap sur un POI
  passe par `selectedFeature` ; un garde compare la sélection avant/après pour ne
  pas refermer aussitôt la fiche qu'on vient d'ouvrir. *(à vérifier sur device :
  `.onTapGesture` est cassé sur `Map` en iOS 26, on passe par
  `simultaneousGesture(TapGesture())`.)*
- **Icône et couleur de favori** personnalisables (`FavoriteAppearance`,
  menu contextuel sur la ligne), stockées côté app : le modèle `Favorite` du
  moteur ne transporte que lat/lon/nom/date, et l'icône ne justifie pas un
  changement de protocole.

### 7.7 Reste à faire

| Sujet | Pourquoi c'est resté dehors |
|---|---|
| **Mode navigation** | Écarté à la demande. C'est le plus gros reliquat : caméra suiveuse inclinée, tracé parcouru/restant, `navigation.progress` (index/total/vitesse, décodé mais toujours inaffiché), heure d'arrivée. |
| Fiche Apple native (`MapItemDetail`) | Donnerait photos/horaires/avis, mais n'accepte aucune action custom : on y perdrait « Positionner ici », « Ajouter une étape », « Copier ». Volontairement écarté. |
| Alternatives multi-étapes | Le point de passage devient ambigu au-delà d'une destination ; Plans ne les propose pas non plus. |

---

## 8. Passe 3 — panneau et recherche (2026-09-19)

### 8.1 Comportement (le lot prioritaire)

| # | Correction | Détail |
|---|---|---|
| 1 | **Suggestions biaisées sur la carte visible** | `SearchCompleter.updateRegion(_ region:)` prend la région affichée, bornée entre ~2 km et ~100 km, au lieu de la position réelle du téléphone. C'était le défaut le plus coûteux : chercher « boulangerie » en regardant Lyon depuis Paris proposait des boulangeries parisiennes — dans une app dont le propos est justement de regarder ailleurs. |
| 2 | **Le focus ouvre le panneau en grand** | `onChange(of: searchFocused)` → `.large` après 80 ms, le temps que le clavier amorce sa montée (les deux animent la même hiérarchie de vues). Avant, le détent ne bougeait qu'au premier caractère, et vers `medium` : clavier monté, il restait deux lignes visibles. |
| 3 | **Vrai mode recherche** | Champ actif et vide → puces de catégories + récents, rien d'autre. Avant, tout l'accueil restait affiché (favoris, GPX, patrouille, Réglages, Signaler un problème) sous le clavier. |
| 4 | **Moins de redimensionnements** | Règle posée dans `MapCoordinator` : on ne change de détent que pour révéler un panneau sur lequel l'utilisateur doit agir. Quatre forçages gratuits supprimés (frappe, changement d'étapes, arrêt de trajet, ajout d'étape à un trajet en cours). |
| 5 | **Placeholder** | « Rechercher un lieu ou une adresse » — on cherche aussi des POI et des catégories. |

### 8.2 Silhouette

- **Favoris en pastilles rondes** (`BottomSheetHomeView.favoritesSection`) plutôt qu'en liste verticale : la silhouette de l'accueil de Plans, et le même vocabulaire visuel que la rangée d'actions de la fiche lieu. Effet de bord bienvenu : plus de géocodage inverse par favori au déploiement de la sheet.
- **En-tête « Suggestions »** sur la liste de recherche, **« Récents »** sur la liste de récents.
- **Hauteur du détent replié figée** (`BottomSheet.collapsedDetentHeight`). Elle était mesurée sur le header par une `PreferenceKey` puis réinjectée dans `presentationDetents` — une boucle de layout dont le résultat changeait selon la nature du header, si bien que sélectionner un lieu faisait bouger le détent replié sous le doigt. Toute la machinerie de mesure est supprimée.
- **`presentationBackgroundInteraction(.enabled(upThrough: .fraction(0.43)))`** : la carte reste manipulable jusqu'au détent moyen seulement, comme Plans.
- **Suppression unitaire d'un récent** par menu contextuel + action d'accessibilité.

### 8.3 Deux choses volontairement écartées

- **Passer le panneau en `List`** pour avoir le balayage-pour-supprimer de Plans. `.swipeActions` n'existe qu'en `List`, mais la sheet héberge des vues non cellulaires (fiche lieu, GPX, patrouille, contrôles de trajet) avec lesquelles une `List` se bat — et l'audit de juin avait justement sorti une `List` imbriquée du `ScrollView`. Le menu contextuel rend le même service sans ce refactor.
- **La distance sur les lignes de suggestion.** `MKLocalSearchCompletion` ne porte aucune coordonnée : c'est une limite de l'API, pas un oubli. La distance n'est calculable qu'après résolution, et Plans ne l'affiche pas non plus sur ses suggestions instantanées.

---

## 9. Passe 4 — liste de résultats et finitions (2026-09-19)

### 9.1 La liste de résultats

Soumettre une recherche posait jusqu'à douze épingles, sélectionnait d'office la
première et ouvrait sa fiche : on ne voyait jamais les résultats ensemble. Plans
affiche la liste dans la sheet, les épingles sur la carte, et laisse choisir.

`SearchResultsListView` rend cette liste — symbole et couleur de catégorie,
nom, catégorie, **distance par ligne**. La distance est calculable ici parce que
ces résultats viennent d'un `MKLocalSearch` résolu, contrairement aux
suggestions du completer où `MKLocalSearchCompletion` ne porte aucune
coordonnée.

Mécanique associée :

- `runTextSearch` ne sélectionne plus d'office : au-delà d'un résultat il laisse
  `selectedPlace` à nil et ouvre la sheet au détent moyen. Un résultat unique va
  directement à sa fiche, comme Plans.
- `dismissSelectedPlace` remplace `clearSelection` sur la croix du header :
  fermer une fiche **revient à la liste** quand il y en a une, au lieu de tout
  effacer.
- Modifier la requête après coup rend la main aux suggestions
  (`ContentView.onChange(of:searchQuery)` compare avec `lastSearchQuery`).
- Un résultat choisi dans la liste entre dans les récents, ce qui n'était plus
  le cas depuis que la sélection d'office a disparu.

### 9.2 Le filet sous le header — et la plomberie morte

`scrollOffset` était mesuré par `PreferenceKey`, remonté à travers
`BottomSheetPresentationContext` puis stocké dans
`MapCoordinator.sheetScrollOffset` — à chaque frame de défilement — et **lu
nulle part**. Chez Plans, c'est précisément ce qui pilote le filet de séparation
sous le header quand le contenu passe dessous.

Les deux sont réglés d'un coup : toute la plomberie disparaît, remplacée par un
`@State private var isContentScrolled` local à `BottomSheet`, réécrit seulement
quand le booléen bascule. Le filet apparaît, et on cesse de réévaluer la sheet
entière pendant qu'on scrolle.

### 9.3 Couche de contrôle de la carte

- **`glassEffectUnion`** sur les trois boutons flottants : ils forment un seul
  bloc de verre comme la pile de contrôles de Plans, au lieu de trois pastilles
  qui lensifient chacune dans son coin. Les zones tactiles restent distinctes.
  `glassEffectID` sur « Rechercher dans cette zone » pour qu'il morphe à
  l'apparition. *(à vérifier sur appareil : ces API ne s'appliquent qu'aux vues
  réellement porteuses d'un effet de verre ; avec `buttonStyle(.glass)` elles
  sont au pire inertes.)*
- **Contrôles masqués au détent plein**, en plus du clavier : la sheet couvre
  alors 92 % de la carte et les boutons remontaient flotter sur le bandeau
  restant.

### 9.4 Non fait : le détent moyen variable

Je l'avais proposé (« `.height()` calculé pour les contenus courts »), puis
écarté à l'implémentation. Deux raisons :

1. Mesurer le contenu pour en déduire un détent, c'est exactement la boucle de
   layout `PreferenceKey` → `presentationDetents` que la passe 3 vient de
   supprimer du détent replié, avec la même instabilité à la clé : si la
   fraction change pendant que la sheet y est posée, la sélection sort du `Set`
   de détents et le système la réinitialise.
2. À la relecture, les cas où le détent moyen affiche un contenu court
   n'existent quasiment pas : le mode recherche ouvre en grand, la fiche lieu et
   la liste de résultats sont longues, les panneaux GPX et patrouille remplissent
   la hauteur. Le vide que j'avais anticipé ne se produit pas.

À reconsidérer seulement si l'usage sur appareil le démontre.
