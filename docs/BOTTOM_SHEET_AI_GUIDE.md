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
- `large`: contenu scrollable complet.

Le `ScrollView` est actif des que la sheet est ouverte (`scrollDisabled(isCollapsed)`).
Il l'etait auparavant au seul detent `large`, ce qui rendait le bas d'une fiche
lieu ou d'une longue liste de resultats inatteignable au detent `medium` — c'est
pourtant le detent vers lequel l'app bascule des qu'on tape ou qu'on choisit un
lieu. Ne pas revenir en arriere la-dessus (voir
`docs/UI_UX_AUDIT_IOS_2026-09.md`, P0-3).

## Barre de recherche

- Le header collapsed doit ressembler a une omnibar Apple Plans: grand champ
  arrondi, icone loupe a gauche, bouton d'effacement a droite dans le champ,
  bouton rond reglages separe (avec pastille d'alerte si le moteur manque).
- Le bouton rond affiche l'action principale du moment: profil/reglages en
  collapsed, croix quand un lieu, une recherche ou un panneau ouvert peut etre
  annule/replie.
- **Quand un lieu est selectionne, le header devient une barre de lieu**
  (pastille de categorie + nom + sous-titre + croix) et le champ de recherche
  disparait, comme dans Plans. Le titre vit donc dans le header, pas dans
  `PlaceCard` — ne pas le remettre dans la carte, il s'afficherait deux fois.
- Ne pas remplacer cette barre par un petit `TextField` compact: la taille et
  le poids visuel du header participent au comportement type Plans.

## Recherche : les trois etats du panneau

1. **Champ actif, requete vide** : puces de categories + recents. Rien d'autre —
   pas l'accueil complet.
2. **Requete en cours de frappe** : suggestions du completer (`MKLocalSearchCompleter`).
3. **Requete soumise** : `SearchResultsListView` (nom, categorie, distance), les
   epingles correspondantes sur la carte. Fermer une fiche revient a cette liste
   (`dismissSelectedPlace`), modifier la requete revient aux suggestions.

Un resultat unique saute directement a sa fiche.

## Detents

- La hauteur du detent replie est **une constante**
  (`BottomSheet.collapsedDetentHeight`). Ne pas la remesurer depuis le header
  via une `PreferenceKey` : la boucle de layout qui en resultait faisait bouger
  le detent quand le header changeait de nature.
- On ne change de detent que pour **reveler un panneau sur lequel l'utilisateur
  doit agir** (fiche lieu, GPX, patrouille, bandeau moteur, itineraire lance),
  plus le focus du champ de recherche qui ouvre en grand. Tout autre
  redimensionnement est un saut non demande.

## Materiau

- Le Liquid Glass appartient a la couche flottante **au-dessus de la carte**
  (`ContentView+MapChrome.swift`, `RecenterButton.swift`). Il ne descend pas
  dans la sheet.
- Dans la sheet, les cartes de contenu utilisent `sheetCardBackground(in:)`
  (`SheetCardBackground.swift`) et les sous-blocs `sheetInnerBackground(in:)`.
  Ne pas reintroduire de `.glassEffect` ni de `.buttonStyle(.glass*)` ici :
  Apple n'empile pas le verre, et Plans passe a des fonds groupes opaques des
  qu'on entre dans le panneau.

## Clavier

- La barre `ToolbarItemGroup(placement: .keyboard)` (« Termine ») doit etre
  declaree sur le contenu de la sheet, pas sur `ContentView` : le champ vit
  dans la presentation de la sheet, et une barre posee sur le presentateur ne
  s'y attache jamais.

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
