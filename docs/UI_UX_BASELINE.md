# UI / UX Baseline — GPS-Mock Companion (iOS 26)

> Référentiel de conception pour l'app SwiftUI `ios-app/`. Vise une conformité
> stricte aux Apple Human Interface Guidelines (HIG) iOS 26, à la baseline
> Liquid Glass, et aux skills internes (`swiftui-liquid-glass`,
> `swiftui-navigation`, `swiftui-patterns`, `mapkit`, `activitykit`,
> `ios-accessibility`, `ios-localization`, `app-intents`, `tipkit`).
>
> Tout changement d'UI dans `ios-app/` doit pouvoir être justifié par une
> entrée de ce document (ou justifier sa mise à jour).

---

## 1. Portée et intention

L'app est un **compagnon de pilotage** d'un moteur Go GPS-Mock. Sa promesse
UX est :

- Une **seule vue** principale (carte plein écran), à la `Plans.app`.
- Pilotage **à un pouce** : téléporter, lancer un trajet, gérer une étape, un
  favori — sans navigation hiérarchique.
- État du moteur **visible mais non intrusif** (Live Activity, badge,
  bannière) — la carte reste l'objet principal en permanence.
- Découverte **zéro-config** (Bonjour), réglages cachés derrière une roue
  dentée.

Conséquence directe : **chaque pixel ajouté au-dessus de la carte doit se
justifier**. Tout ce qui peut vivre en Live Activity, dans une sheet, ou dans
un App Intent doit y vivre.

---

## 2. Points forts existants — à préserver

Ces choix sont déjà conformes (ou très proches) de la baseline Apple. Ils
définissent le caractère de l'app et **ne doivent pas régresser**.

### 2.1 Architecture de vue

- **Carte plein écran `Map` SwiftUI native** ([EngineMapView.swift](../ios-app/Sources/EngineMapView.swift))
  avec `MapReader`, `UserAnnotation()`, `MapPolyline` — pas de UIViewRepresentable
  inutile.
- **Sheet persistante** avec `presentationDetents([.height(120), .medium, .large])`
  + `presentationBackgroundInteraction(.enabled)` + `interactiveDismissDisabled()`
  ([ContentView.swift:127-171](../ios-app/Sources/ContentView.swift)).
  C'est **le** pattern Plans : la sheet ne disparaît jamais, la carte reste
  manipulable derrière. À garder tel quel.
- **Découplage strict** : `EngineMapView` ne sait rien du moteur, il reçoit
  des coordonnées. `ContentView` orchestre. `BottomSheet` ne fait que de la
  présentation. Bonne séparation MVVM-light.

### 2.2 Liquid Glass — fondations correctes

- `.glassEffect(.regular.interactive(), in: .capsule)` sur l'omnibar
  ([BottomSheet.swift:144](../ios-app/Sources/BottomSheet.swift)).
- `.buttonStyle(.glass)` / `.buttonStyle(.glassProminent)` partout pour les
  contrôles flottants.
- Utilisation de `RoundedRectangle(cornerRadius: 26, style: .continuous)`
  comme forme de glass — `.continuous` est le bon choix HIG.

### 2.3 Interactions natives

- **Long-press** sur la carte pour drop-pin via `LongPressGesture.sequenced(before: DragGesture(minimumDistance: 0))`
  — contournement documenté de la régression `.onTapGesture` iOS 26 sur `Map`,
  cf. skill `swiftui-gestures`. Le commentaire en place est précieux,
  **le conserver**.
- `MapCameraPosition.userLocation(fallback: .automatic)` — sémantique Apple.
- `sensoryFeedback(.success, trigger:)` sur les actions confirmées
  (long-press, lancement, ajout favori). Conforme HIG haptique.
- `ContentUnavailableView` sur les états vides (favoris vides, journaux
  vides) — composant natif iOS 17+, à garder.

### 2.4 État système

- **Live Activity** correctement câblée (start / update / end, lifecycle
  géré dans [LiveActivityManager.swift](../ios-app/Sources/LiveActivityManager.swift)),
  avec **toggle utilisateur** dans les réglages — exigence implicite de la
  HIG (l'utilisateur doit pouvoir opt-out d'une Live Activity Lock Screen).
- Dynamic Island avec ses **trois variantes** (compact, expanded, minimal)
  — bon respect du skill `activitykit`.
- `keylineTint(.indigo)` posée — à garder mais voir §3.2.

### 2.5 Réseau et persistance

- **Bonjour/mDNS** (`_gpsmock._tcp`) avec `NSLocalNetworkUsageDescription`
  motivée — conforme guidelines AppStore review.
- **Persistance du dernier itinéraire** en UserDefaults — la promesse « votre
  itinéraire reste enregistré » du message d'erreur ([ContentView.swift:185](../ios-app/Sources/ContentView.swift))
  est honorée. UX-clé pour un outil de simulation où la déconnexion est
  fréquente.
- `MKLocalSearch` natif **sans clé API** — pas de dépendance externe, pas de
  problème ATT, pas de PrivacyManifest à compléter.

### 2.6 Reframing intelligent

- `fitItinerary(_:)` ([ContentView.swift:365-374](../ios-app/Sources/ContentView.swift))
  inclut la position réelle dans le bounding box des étapes — le trajet
  commence là où le téléphone est. C'est ce que fait Plans, à garder.
- Padding × 1.6 avec plancher — évite l'over-zoom sur deux points proches.

---

## 3. Écarts à la baseline Apple — à corriger

Classés par criticité, du **bloquant** (régression visuelle ou
accessibilité) au **polish**.

### 3.1 [CRITIQUE] Ombres portées sur du Liquid Glass

**Symptôme** : `.shadow(color: .black.opacity(0.12), radius: 10, y: 3)`
appliqué sur l'omnibar et le bouton réglages ([BottomSheet.swift:145](../ios-app/Sources/BottomSheet.swift),
[ContentView.swift:92](../ios-app/Sources/ContentView.swift)).

**Problème HIG** : Le matériau Liquid Glass porte **sa propre profondeur**
(le système rend le lensing et l'élévation). Ajouter une ombre manuelle
casse l'illusion de translucidité, alourdit le rendu, et produit un halo
sombre incohérent avec le reste du système (Control Center, Plans, etc.
n'en mettent jamais).

**Fix** : supprimer toutes les `.shadow(...)` posées sur des vues
`.glassEffect(...)` ou `.buttonStyle(.glass*)`. La hiérarchie visuelle est
déjà portée par le matériau.

### 3.2 [CRITIQUE] Absence de `GlassEffectContainer`

**Symptôme** : plusieurs vues sœurs portent chacune leur propre
`.glassEffect(...)` (omnibar, bouton réglages, bouton recenter, place card,
simulation control bar). Chacune lensifie indépendamment.

**Problème** : le skill `swiftui-liquid-glass` est sans ambiguïté — les
glass siblings doivent être groupés sous un `GlassEffectContainer { … }`
pour partager la passe de lensing et permettre les transitions de morph
(`glassEffectUnion`, `glassEffectID`). Sans container, les éléments se
recouvrent sans fusionner, les animations sont saccadées, et le coût GPU
double.

**Fix** : envelopper la couche flottante au-dessus de la carte dans un
`GlassEffectContainer` (typiquement dans `ContentView.body`, le `ZStack` qui
empile `EngineMapView` et les overlays). Donner un `.glassEffectID(_:in:)`
aux contrôles qui apparaissent/disparaissent (PlaceCard, simulation bar)
pour bénéficier du morph.

### 3.3 [CRITIQUE] Cibles tactiles sous 44 pt

**Symptôme** :
- Bouton roue dentée : `frame(width: 42, height: 42)` ([ContentView.swift:87](../ios-app/Sources/ContentView.swift)).
- Boutons play/pause/stop : `frame(width: 36, height: 36)` ([BottomSheet.swift:157, 166, 173](../ios-app/Sources/BottomSheet.swift)).

**Problème HIG** : la minimale absolue d'une **hit-target** est **44 × 44 pt**
(HIG iOS — Layout → Touch targets). 36 pt est en dessous, 42 pt frôle.

**Fix** : tous les boutons icône-seule doivent avoir un frame ≥ 44 × 44.
L'icône peut rester petite ; ce qui compte est la zone tactile. Utiliser
`.contentShape(Rectangle())` si l'on garde un visuel plus petit.

### 3.4 [CRITIQUE] Aucune `accessibilityLabel` sur les boutons icône-seule

**Symptôme** : `Image(systemName: "gearshape.fill")` dans un `Button` sans
`label` texte ⇒ VoiceOver lit « bouton ». Idem recenter, clear, play, pause,
stop, dismiss de PlaceCard.

**Problème HIG** : non-conformité accessibilité, et probable rejet App Store
Review si soumis (App Review section 1.5 + a11y guidelines).

**Fix systémique** : pour chaque bouton icône-seule, fournir un
`Label("Réglages", systemImage: "gearshape.fill")` *avec*
`.labelStyle(.iconOnly)` (le label reste pour VoiceOver, l'icône seule
s'affiche), **ou** ajouter `.accessibilityLabel("Réglages")`. La première
forme est préférée — un seul endroit pour la chaîne, plus facile à
localiser. Cf. skill `ios-accessibility`.

### 3.5 [MAJEUR] Live Activity non interactive

**Symptôme** : la Live Activity affiche pause/actif mais ne propose pas de
boutons. L'utilisateur doit ouvrir l'app pour mettre en pause / arrêter.

**Problème** : iOS 17+ permet des `Button(intent: …)` directement dans la
Live Activity et le Dynamic Island étendu via App Intents (skill
`activitykit` + `app-intents`). Plans/Maps, Apple Music, Wallet l'exploitent
systématiquement.

**Fix** : créer trois App Intents `PauseSimulationIntent`,
`ResumeSimulationIntent`, `StopSimulationIntent` (cf. skill `app-intents`)
qui dialoguent avec le moteur via une `URLSession` partagée (App Group), et
les exposer dans `DynamicIslandExpandedRegion(.trailing)` + dans la vue Lock
Screen. Bonus immédiat : ils deviennent **invocables depuis Siri et
Raccourcis** sans travail supplémentaire.

### 3.6 [MAJEUR] `.indigo` codé en dur partout

**Symptôme** : `.tint(.indigo)`, `.foregroundStyle(.indigo)`,
`.background(.indigo, in: Circle())` répandus dans 8+ fichiers.

**Problème HIG** : pas de respect du **system accent color** ni des
dark/light variants asset-catalog. Sur appareils où l'utilisateur a forcé
un autre accent, les contrôles n'obéissent pas. Casse également la cohérence
dark mode (l'indigo brut tire vers le sombre).

**Fix** :
1. Définir `AccentColor` dans `Assets.xcassets` avec deux variantes
   (Any/Dark) calibrées pour rester lisibles sur Liquid Glass.
2. Remplacer `.tint(.indigo)` par `.tint(Color.accentColor)` ou laisser
   hériter (la majorité des sites peut être supprimée).
3. Le marqueur « Position simulée » et la polyline peuvent conserver une
   teinte fixe — c'est de la **donnée visuelle**, pas un contrôle (cf. §3.13).

### 3.7 [MAJEUR] Sous-utilisation du Dynamic Type

**Symptôme** : `Image(systemName: "...").font(.system(size: 16, weight: .semibold))`
([ContentView.swift:86](../ios-app/Sources/ContentView.swift)),
`.font(.system(size: 17, weight: .semibold))` dans RecenterButton, etc.
Tailles fixes au lieu de styles sémantiques.

**Problème HIG** : casse Dynamic Type. Un utilisateur en accessibilité XXL ne
voit pas d'agrandissement des icônes des contrôles primaires.

**Fix** : utiliser les styles sémantiques (`.title3`, `.headline`,
`.body.weight(.semibold)`). Pour les frames, utiliser `@ScaledMetric` :
```swift
@ScaledMetric private var controlSize: CGFloat = 44
```
Cf. skill `ios-localization` (section Dynamic Type) et `ios-accessibility`.

### 3.8 [MAJEUR] `MKLocalSearch` au lieu de `MKLocalSearchCompleter`

**Symptôme** : recherche full-text avec debounce 350 ms
([ContentView.swift:254-276](../ios-app/Sources/ContentView.swift)). Chaque
frappe attend, puis envoie une requête complète.

**Problème UX** : Plans utilise `MKLocalSearchCompleter` qui propose des
**complétions** au fil de la frappe (latence ressentie ≈ 0), puis n'envoie
une `MKLocalSearch` complète qu'après sélection d'une complétion.

**Fix** : adopter `MKLocalSearchCompleter` pour les suggestions (autoroute
mémorielle des compositeurs SwiftUI : `@StateObject` qui wrappe le delegate),
garder `MKLocalSearch` pour la résolution finale. Skill `mapkit`.

### 3.9 [MAJEUR] Alerte modale pour erreur de connexion

**Symptôme** : `.alert("Action impossible", …)` ([ContentView.swift:182-186](../ios-app/Sources/ContentView.swift))
à chaque action sur moteur déconnecté.

**Problème HIG** : « *Alerts deliver important, often critical information.
… If an alert appears too frequently, people may dismiss it without
reading it.* » (HIG → Alerts). Une déconnexion est récurrente dans cet
outil — un usage routinier.

**Fix** : remplacer par un **banner inline** dans la sheet (au-dessus de
l'omnibar ou en remplacement de l'omnibar quand non connecté), avec un
`Button("Connecter")` qui ouvre les réglages. iOS 26 fournit
`safeAreaInset(edge: .top)` ou un overlay sur la sheet. Pattern Plans :
bannière jaune en haut de la sheet « Connexion réseau perdue ».

### 3.10 [MAJEUR] Localisation : strings codés en dur

**Symptôme** : `Text("Itinéraire")`, `Text("Téléporter")`, etc. directement
en chaînes françaises.

**Problème** : aucun **String Catalog (.xcstrings)**, donc :
- Impossibilité de tester un export (`xcrun xcstringstool`).
- Pas de pluralisation correcte (`stops.count > 1 ? "s" : ""` au lieu d'une
  variant `plural`).
- Aucune extensibilité multilingue (même si l'app reste FR-only, c'est la
  baseline iOS 26 et l'outillage Xcode l'attend).
- Pluriels approximatifs (« 0 étape » devrait être « 0 étape »… mais le
  code mettrait « 0 étape » correctement, alors que « 1 étape » et « 2
  étapes » sont gérés par le bricolage actuel ; cas limite : 21 ⇒ « 21
  étapes » OK, mais en russe ou arabe ce serait faux).

**Fix** :
1. Ajouter `Localizable.xcstrings` (String Catalog) ; iOS 26 + Xcode 16+
   génère des **symboles de chaînes** statiquement typés (cf. skill
   `ios-localization`).
2. Convertir les `Text("…")` en `Text(.itineraireTitle)` (généré).
3. Utiliser les variants `plural` pour les compteurs.

### 3.11 [MAJEUR] `.sheet(isPresented: .constant(true))` + sheet imbriquée

**Symptôme** : la bottom-sheet persistante est présentée avec
`.constant(true)` ([ContentView.swift:127](../ios-app/Sources/ContentView.swift))
et la SettingsSheet via une **deuxième** `.sheet` simultanée
([ContentView.swift:172](../ios-app/Sources/ContentView.swift)).

**Problème** : deux sheets simultanées sur la même hiérarchie est fragile
en iOS 26 (régressions documentées : flicker, perte de `presentationDetents`,
gesture conflicts avec le drag indicator). Le pattern `.constant(true)` est
en plus un hack vis-à-vis de la sémantique de `isPresented`.

**Fix recommandé** :
- Garder la bottom-sheet en **persistante** (pattern Plans correct), mais
  envisager de la basculer en `Inspector` API iOS 26 ou de l'**inlineer**
  dans le ZStack avec un `safeAreaInset(edge: .bottom)` + animation
  `presentationDetents`-équivalente — c'est en fait ce que Plans fait
  techniquement.
- La sheet Réglages doit alors être présentée *à partir* du persistent
  panel et non en parallèle. Soit en `fullScreenCover` (overlay total), soit
  en `NavigationStack` poussé depuis la sheet (`NavigationLink` en mode
  push), évitant la collision.

### 3.12 [MAJEUR] `List` interne à un `ScrollView`, avec `scrollDisabled(true)`

**Symptôme** : `ItineraryPanel` met une `List { … }.scrollDisabled(true)`
dans une `ScrollView` parente ([BottomSheet.swift:50](../ios-app/Sources/BottomSheet.swift)
+ [ItineraryPanel.swift:54-94](../ios-app/Sources/ItineraryPanel.swift)).

**Problème** : nested-scroll, gestes de drag-to-reorder qui se battent avec
le drag du parent, perf cell-reuse non garantie en `.scrollDisabled`.
`frame(height: rowHeight * count)` est fragile à Dynamic Type.

**Fix** : remplacer la `List` par un `LazyVStack` + un `ForEach`. Pour le
drag-to-reorder hors List, iOS 26 a `.onDrag/.onDrop` ou la nouvelle
`reorderable` (skill `swiftui-patterns`). Sinon, **extraire** la List du
ScrollView en faisant de la sheet elle-même une `List` (et en y ajoutant
les autres sections en `Section`).

### 3.13 [MAJEUR] Marqueur position simulée vs blue dot

**Symptôme** : deux annotations actives — `UserAnnotation()` (blue dot
système) et `Marker("Position simulée", systemImage: "location.fill")`
([EngineMapView.swift:23-27](../ios-app/Sources/EngineMapView.swift)) en
indigo.

**Problème UX** : quand la dérive est faible (< 30 m), les deux pastilles se
chevauchent et l'utilisateur ne distingue plus l'un de l'autre. Le `Marker`
porte aussi un label texte « Position simulée » qui s'affiche en
permanence — bruyant sur la carte.

**Fix** :
1. Remplacer `Marker` par une `Annotation` custom : pastille indigo + ring
   blanc + `symbolEffect(.pulse, options: .repeating)` pour la distinguer
   activement du blue dot. Pas de label texte par défaut.
2. Si dérive > seuil, dessiner un cercle pointillé qui relie blue dot et
   marker (ligne de dérive visualisée).
3. Garder le label « Position simulée » dans un *callout* (tap), pas en
   permanence.

### 3.14 [MAJEUR] Aucun contrôle de carte (boussole, échelle, pitch)

**Symptôme** : `Map { … }` sans `mapControls { … }`.

**Problème HIG** : Plans propose au minimum compass + scale + user location
button. L'utilisateur perd toute notion d'orientation après un pinch
rotation.

**Fix** :
```swift
.mapControls {
    MapCompass()
    MapScaleView()
    MapPitchToggle()
}
```
Skill `mapkit`. À envelopper dans un `GlassEffectContainer` avec les autres
overlays.

### 3.15 [MINEUR] Bouton « Fermer » dans la SettingsSheet

**Symptôme** : `Button("Fermer") { dismiss() }` en `.confirmationAction`
([SettingsSheet.swift:108-110](../ios-app/Sources/SettingsSheet.swift)).

**HIG** : la convention iOS 26 est **« Terminé »** (`Done`) pour fermer une
sheet de réglages où l'utilisateur n'« annule » ni ne « confirme » rien.
« Fermer » est plus proche d'une dismissal de dialogue d'info.

**Fix** : `Button(role: .close) { dismiss() }` (iOS 26) qui pose le bon
glyph + label localisé automatiquement. Ou simplement `Button("Terminé")`.

### 3.16 [MINEUR] PlaceCard : 4 actions en row sur petits écrans

**Symptôme** : 4 `actionButton` côte-à-côte avec `Text(title).font(.caption2)`
([PlaceCard.swift:51-56](../ios-app/Sources/PlaceCard.swift)).

**Problème** : sur iPhone SE 2 (320 pt safe-area horizontal après padding
sheet), les labels « Téléporter » / « Itinéraire » sont coupés en
Dynamic Type ≥ Large. `caption2` est aussi en dessous du minimum lisible
HIG.

**Fix** : passer en `.caption` minimum, et **wrapper la row dans un
`ScrollView(.horizontal, showsIndicators: false)`** qui devient
scrollable si nécessaire. Pattern Plans. Cibles tactiles ≥ 44 pt
verticalement.

### 3.17 [MINEUR] `clipShape(Circle())` après `buttonBorderShape(.circle)`

**Symptôme** : sur les boutons glass circulaires :
```swift
.buttonStyle(.glass)
.buttonBorderShape(.circle)
.clipShape(Circle())
```
([ContentView.swift:90-91](../ios-app/Sources/ContentView.swift),
[RecenterButton.swift:14-16](../ios-app/Sources/RecenterButton.swift)).

**Problème** : le `clipShape` clipe **aussi** le halo de lensing que le
moteur Liquid Glass dessine légèrement en dehors de la border-shape.
Résultat : effet « plat » comparé aux contrôles natifs.

**Fix** : supprimer `clipShape(Circle())`. `buttonBorderShape(.circle)`
suffit, le système gère la forme et le halo.

### 3.18 [MINEUR] Stepper km/h vs Slider

**Symptôme** : `Stepper("\(Int(speed)) km/h", value: $speed, in: 5...130, step: 5)`
([ItineraryPanel.swift:107](../ios-app/Sources/ItineraryPanel.swift)).

**HIG** : Stepper est adapté pour des petits ajustements (1–10 valeurs).
Pour une plage 5–130, c'est 25 incréments — beaucoup de tap. Un `Slider`
continu (ou un `TextField` numérique avec `keyboardType(.numberPad)`)
serait plus rapide. Plans utilise un slider pour la vitesse simulée dans
Xcode/Simulator.

**Fix** : `Slider(value: $speed, in: 5...130, step: 5) { Text("Vitesse") }`
avec un label dynamique à droite.

### 3.19 [MINEUR] Picker profil sans icônes

**Symptôme** : `Picker { Text("Voiture"); Text("Marche") }.pickerStyle(.segmented)`.

**HIG** : un segmented control bénéficie d'icônes pour les libellés courts.
Plans : `car.fill` / `figure.walk`.

**Fix** :
```swift
Picker("Profil", selection: $profile) {
    Label("Voiture", systemImage: "car.fill").tag("driving")
    Label("Marche", systemImage: "figure.walk").tag("walking")
}
.pickerStyle(.segmented)
```

### 3.20 [MINEUR] `reduceTransparency` non géré

**Symptôme** : aucun `@Environment(\.accessibilityReduceTransparency)` dans
le code.

**Problème** : sur cet accessibility setting, le système **doit** afficher
un fond opaque. Liquid Glass dégrade auto la plupart du temps, mais les
shadows posées en §3.1 + les couches `.glassEffect` manuelles peuvent
laisser passer un fond translucide. Vérifier en activant le toggle dans
Simulator → Accessibility.

**Fix** : prévoir une fallback `background(.regularMaterial)` ou
`background(Color(.systemBackground))` quand l'environnement le demande.

### 3.21 [POLISH] Discoverability du long-press carte

**Symptôme** : drop-pin sur long-press 0.5 s, aucun affordance visuel.
Première découverte de l'utilisateur = hasard.

**Fix** : skill `tipkit`. Ajouter un `TipView` ancré à la roue dentée ou
en bas de la sheet la première fois : « Maintenez la carte enfoncée pour
téléporter ou ajouter une étape ». Auto-dismiss après 1er long-press
réussi (`Tips.configure`).

### 3.22 [POLISH] `Timer.scheduledTimer` au lieu de structured concurrency

**Symptôme** : `Timer.scheduledTimer(withTimeInterval: 10, repeats: true)`
pour `sendRealLocation` ([ContentView.swift:443](../ios-app/Sources/ContentView.swift)).

**Problème** : ne se met pas en pause quand l'app passe en background, et
le `Timer` n'est pas invalidé à la destruction de la vue. Risque léger de
fuite + dépense batterie.

**Fix** : remplacer par une `Task { while !Task.isCancelled { … try await Task.sleep(for: .seconds(10)) } }`
attachée à un `.task(id: engine.state)` qui s'auto-annule à la déconnexion
et au backgrounding (la `Task` est attachée à la vie de la vue). Skill
`swift-concurrency`.

### 3.23 [POLISH] App Intents pour favoris

**Symptôme** : aucun App Intent exposé.

**Fix** : exposer chaque `Favorite` comme `AppEntity` (skill `app-intents`)
+ un `TeleportToFavoriteIntent` ⇒ Siri (« Téléporte-moi à Maison »),
Raccourcis, Spotlight. Très peu de code, énorme gain de discoverability.

### 3.24 [POLISH] Adresse moteur par défaut

**Symptôme** : `@AppStorage("engineAddress") = "192.168.1.1:8080"`.

**Problème** : valeur arbitraire qui s'affiche au premier lancement avant
même que Bonjour ait pu trouver. Crée l'impression d'un faux state
« connecté à 192.168.1.1 ».

**Fix** : valeur par défaut **vide**, et le champ TextField utilise un
`prompt: Text("auto-découverte en cours…")` quand vide.

### 3.25 [POLISH] LogsView sans recherche ni filtre niveau

**Symptôme** : `List { ForEach(engine.logs.reversed()) … }`. Pas de
`.searchable`, pas de filtre level.

**Fix** : ajouter `.searchable(text: $logQuery)` + un `Picker` segmenté
(All / Info / Warn / Error) en `safeAreaInset(edge: .top)`. Skill
`swiftui-navigation` (section searchable).

---

## 4. Roadmap d'amélioration — priorisation

| # | Étape | Effort | Impact | Section |
|---|---|---|---|---|
| 1 | Retirer toutes les `.shadow()` sur glass | XS | Visuel critique | 3.1 |
| 2 | `GlassEffectContainer` autour des overlays | S | Visuel critique | 3.2 |
| 3 | Frames ≥ 44 pt + `accessibilityLabel` sur tous les boutons icône | S | A11y critique | 3.3, 3.4 |
| 4 | App Intents Pause/Resume/Stop + Live Activity interactive | M | UX majeur | 3.5 |
| 5 | `AccentColor` + suppression `.indigo` codés en dur | S | Cohérence dark mode | 3.6 |
| 6 | Dynamic Type via styles sémantiques + `@ScaledMetric` | S | A11y | 3.7 |
| 7 | `MKLocalSearchCompleter` pour suggestions live | M | UX recherche | 3.8 |
| 8 | Banner inline au lieu d'alerte « moteur déconnecté » | S | UX bruit | 3.9 |
| 9 | String Catalog `.xcstrings` + symboles générés | M | Maintenabilité | 3.10 |
| 10 | Décomposer les deux sheets simultanées | M | Stabilité | 3.11 |
| 11 | Sortir la List de l'itinéraire du ScrollView | S | Perf + drag | 3.12 |
| 12 | Annotation simulée custom + symbolEffect | S | Lisibilité carte | 3.13 |
| 13 | `mapControls { MapCompass / Scale / Pitch }` | XS | Conformité Plans | 3.14 |
| 14 | App Intents favoris (Siri / Raccourcis / Spotlight) | M | Discoverability | 3.23 |
| 15 | `TipKit` pour long-press carte | XS | Onboarding | 3.21 |
| 16 | `Task.sleep` au lieu de `Timer` | S | Batterie | 3.22 |
| 17 | Slider vitesse + icônes Picker profil | XS | Polish | 3.18, 3.19 |
| 18 | LogsView : searchable + filtre niveau | S | Debug | 3.25 |
| 19 | `reduceTransparency` fallback | XS | A11y | 3.20 |

**Recommandation** : traiter le bloc 1–6 dans un même PR « UI baseline pass »
(quasi sans risque, gain visuel et a11y immédiat). Le bloc 7–14 en PRs
suivants, chacun isolable.

---

## 5. Règles d'or — checklist pour chaque PR touchant l'UI

À copier en tête de description PR quand des changements UI sont proposés :

- [ ] Aucune `.shadow()` posée sur une vue `.glassEffect()` ou
      `.buttonStyle(.glass*)`.
- [ ] Tout cluster de glass siblings est dans un `GlassEffectContainer`.
- [ ] Toute hit-target ≥ 44 × 44 pt (utiliser `.contentShape` si visuel
      plus petit).
- [ ] Tout bouton icône-seule a un `Label("…", systemImage: …)
      .labelStyle(.iconOnly)` ou `.accessibilityLabel(…)`.
- [ ] Aucun `.font(.system(size: …))` magique : utiliser
      `.headline`/`.body`/etc., ou `@ScaledMetric` pour les frames.
- [ ] Aucune couleur sémantique codée en dur (`.indigo`, `.blue`) sur un
      *contrôle* — utiliser `Color.accentColor`. Les **données visuelles**
      (marqueur, polyline) peuvent garder une teinte fixe.
- [ ] Toute chaîne nouvelle passe par le String Catalog.
- [ ] Pas de `Timer.scheduledTimer` pour de la périodicité liée à une vue —
      `.task` + `Task.sleep`.
- [ ] Si l'élément introduit un geste non standard, prévoir un `TipKit`
      d'onboarding ou un affordance visuel.
- [ ] Testé en : Dynamic Type **AX5**, **Dark Mode**, **Reduce Transparency
      ON**, **VoiceOver ON** (lecture de l'écran complet).

---

## 6. Références skills internes

- **`swiftui-liquid-glass`** — §3.1, 3.2, 3.17, 3.20.
- **`swiftui-navigation`** — §3.11, 3.25.
- **`swiftui-patterns`** — §3.12 (drag/reorder hors List).
- **`swiftui-gestures`** — §2.3 (long-press patterns), §3.21.
- **`swiftui-layout-components`** — §3.16, 3.18, 3.19.
- **`swiftui-performance`** — §3.12.
- **`mapkit`** — §3.8, 3.13, 3.14.
- **`activitykit`** — §3.5.
- **`app-intents`** — §3.5, 3.23.
- **`tipkit`** — §3.21.
- **`ios-accessibility`** — §3.3, 3.4, 3.7, 3.20.
- **`ios-localization`** — §3.7, 3.10.
- **`swift-concurrency`** — §3.22.
- **`app-store-review`** — §3.4 (a11y requise pour soumission).

Toute évolution de cette baseline doit citer le ou les skills concernés et,
si nécessaire, mettre à jour ce document.
