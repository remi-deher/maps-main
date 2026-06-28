# Bottom Sheet iOS - Guide pour IA

Ce guide sert a orienter une IA qui modifie la bottom sheet iOS de GPS-Mock.
Le comportement attendu est celui d'une sheet fluide type Plans/Music: le
drag, les detents et l'inertie doivent rester controles par SwiftUI/UIKit, pas
par un composant custom.

## Principe central

- La bottom sheet persistante est une vraie `.sheet` SwiftUI dans
  `ios-app/Sources/ContentView.swift`.
- Les hauteurs sont declarees avec `presentationDetents` dans
  `ios-app/Sources/ContentView+BottomSheetContent.swift`.
- `SheetDetent` dans `ios-app/Sources/FloatingSheet.swift` est seulement l'etat
  metier de l'app (`collapsed`, `medium`, `large`).
- `nativeSheetDetent` est le detent systeme (`PresentationDetent`) qui pilote
  vraiment l'interface.
- Les deux etats sont synchronises par `syncNativeSheetDetent(to:)` et
  `syncSheetDetent(to:)`.

## Ce qu'il ne faut pas faire

- Ne pas recreer un `DragGesture` maison pour redimensionner la sheet.
- Ne pas modifier la hauteur de la sheet a chaque pixel du drag.
- Ne pas piloter la carte ou les boutons flottants depuis une hauteur live.
- Ne pas presenter une deuxieme `.sheet` depuis le root qui presente deja la
  bottom sheet persistante.
- Ne pas laisser des panneaux lourds visibles au detent minimal.

## Comportement attendu par detent

- `collapsed`: seul le header/search field est visible. Les panneaux GPX,
  patrouille, resultats et controles secondaires ne doivent pas depasser.
- `medium`: contenu principal consultable, utile pour resultats, lieu choisi,
  import GPX ou options rapides.
- `large`: contenu scrollable complet. Le `ScrollView` est active seulement ici
  via `scrollDisabled(sheetDetent != .large)`.

## Barre de recherche

- Le header collapsed doit ressembler a une omnibar Apple Plans: grand champ
  arrondi, icone loupe a gauche, micro a droite dans le champ, bouton rond
  profil/reglages separe.
- Le bouton rond affiche l'action principale du moment: profil/reglages en
  collapsed, croix quand un lieu, une recherche ou un panneau ouvert peut etre
  annule/replie.
- Ne pas remplacer cette barre par un petit `TextField` compact: la taille et
  le poids visuel du header participent au comportement type Plans.

## Modales et actions secondaires

- Les modales lancees depuis la bottom sheet doivent etre attachees au contenu
  de la sheet (`bottomSheetContent`), pas au root `ContentView`.
- Le picker GPX et les Reglages sont donc attaches dans
  `ContentView+BottomSheetContent.swift`.
- La fermeture par la croix doit appeler `collapseBottomSheet()`, qui met a jour
  a la fois `sheetDetent` et `nativeSheetDetent`.

## Carte et clavier

- La carte reste interactive derriere la sheet grace a
  `presentationBackgroundInteraction(.enabled)`.
- Les boutons flottants de carte lisent seulement le detent repose, pas la
  hauteur live de la sheet.
- Quand le clavier est ouvert, le chrome de carte est masque dans
  `ContentView+MapChrome.swift`.

## Checklist avant modification

- La sheet reste native (`.sheet` + `presentationDetents`).
- Le detent collapsed ne montre que le header.
- Les actions qui ferment/reduisent la sheet synchronisent les deux etats.
- GPX, Reglages et autres presenters ne creent pas de collision de sheets.
- `git diff --check` passe.
- Le build iOS CI doit rester vert apres push.
