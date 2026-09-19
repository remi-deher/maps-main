# GPS-Mock Companion (iOS)

App SwiftUI, façon Plans (carte plein écran MapKit + bottom sheet
persistante, iOS 26), qui tourne sur l'iPhone à côté de l'app GPS-Mock
desktop :

- Carte plein écran (`Map`/`MapReader` SwiftUI natifs) avec la position
  réelle (point bleu) et la position simulée (anneau pulsé) ; maintenir un
  point enfoncé propose de s'y téléporter, lancer un trajet jusqu'ici, ou
  l'ajouter en favori.
- **Trois couches, comme Plans** : la carte, les contrôles flottants en
  Liquid Glass au-dessus d'elle (`ContentView+MapChrome.swift`,
  `RecenterButton.swift` — 2D/3D, calques, recentrage), et une **bottom sheet
  persistante** (`BottomSheet.swift` et les vues `BottomSheet*`) au contenu
  opaque. Le verre s'arrête à la couche flottante : à l'intérieur de la sheet
  les cartes utilisent des fonds groupés (`SheetCardBackground.swift`), ce qui
  évite le verre empilé sur du verre. Voir
  `docs/UI_UX_AUDIT_IOS_2026-09.md`.
- **Recherche** dans le header de la sheet (`BottomSheetSearchField.swift`) :
  suggestions instantanées via `MKLocalSearchCompleter` (natif, pas de clé
  API), fragments saisis surlignés, résultats multiples épinglés sur la carte.
- **État du moteur visible** (`BottomSheetStatusBannerView.swift`) : bandeau
  « Moteur non connecté » avec bouton Connecter quand la liaison manque,
  affichage permanent de la position injectée et de la dérive sinon. Le
  détail (adresse, appairage, pilote, découverte réseau) reste dans la feuille
  de réglages (`SettingsSheet.swift`) ouverte via le bouton rond du header.
- **Première ouverture** (`FirstRunPrimerCard.swift`) : les autorisations
  (position, réseau local, notifications) sont expliquées avant d'être
  demandées, au lieu de trois alertes système empilées au lancement.
- Découverte automatique du moteur sur le réseau local via Bonjour/mDNS
  (`_gpsmock._tcp`, voir `EngineDiscovery.swift`) : plus besoin de taper
  l'IP:port à la main si le moteur est sur le même réseau. Le moteur Go
  s'annonce lui-même au démarrage (`engine/cmd/headless/run.go`,
  `advertiseMdns`) — desktop comme headless, puisque c'est le même binaire.
- **Appairage sécurisé** (`EnginePairing.swift`) : le moteur n'accepte un
  client distant (le téléphone l'est toujours, via le Wi-Fi) qu'après
  appairage. L'app redime **une seule fois** le code rotatif à 6 chiffres
  affiché côté bureau (section « Accès distant ») — par scan du QR Code
  (`http://host:port/?pair=<code>`) ou saisie manuelle — contre un token
  durable rangé dans le Trousseau (`EngineTokenStore`). Les connexions
  suivantes, y compris après un redémarrage du moteur, réutilisent ce token
  sans réappairage. Révocable depuis le bureau (« Accès distant » →
  appareils).
- Liste les favoris du moteur (ajout/suppression/téléportation en un tap).
- Remonte la position réelle de l'appareil (`REAL_LOCATION`) toutes les 10s
  pour le bouclier anti-dérive du moteur (re-injecte la position simulée si
  elle a trop dérivé — voir `engine/internal/engine/engine.go`,
  `ReportRealLocation`).
- **Maintien en arrière-plan** (réglable, activé par défaut — mirroring
  `EveilMode`/`EveilInterval` du moteur, `engine/internal/settings/schema.go`) :
  une fois l'autorisation de localisation « Toujours » accordée et
  `allowsBackgroundLocationUpdates` activé (`LocationManager.swift`,
  `UIBackgroundModes: location` dans `project.yml`), l'app continue de
  tourner en arrière-plan et renvoie périodiquement `RELANCE` au moteur
  (`ContentView.swift`, `startKeepAlive`) pour qu'il ré-injecte la dernière
  position simulée — le même rôle que la tâche `expo-task-manager` de
  `legacy/client/src/services/background.ts`, qui postait sur `/api/relance`.
  Le cadran (toggle + intervalle) est dans Réglages → « Maintien en
  arrière-plan ».
- **Notifications locales configurables** (`NotificationManager.swift`),
  portage de `legacy/client/src/services/notifications.ts` : prévient à
  l'arrivée d'un itinéraire et en cas de perte de connexion au moteur.
  Indépendant de la Live Activity (qui reste l'affichage permanent
  écran verrouillé/Dynamic Island) ; réglable dans Réglages → Notifications.
- **Routing OSRM côté client** (`OSRMClient.swift`), portage de
  `legacy/client/src/utils/routing.ts` (`fetchRoute`/`snapToRoad`) : les
  estimations distance/ETA par étape d'itinéraire (`recomputeLegEstimates`
  dans `ContentView.swift`) interrogent le même routeur OSRM que celui
  utilisé côté moteur (`engine/internal/engine/simulation.go`), au lieu du
  routing Apple Maps de MapKit qui peut choisir un trajet différent de celui
  que la simulation va réellement suivre. Repli automatique sur MKDirections
  si le serveur OSRM public est inaccessible (pas de réseau, indisponibilité).
- **Journaux côté app** (`AppLogger.swift`) : buffer en mémoire (200 entrées,
  aussi miroité vers `os.Logger`/Console.app) des événements client —
  connexion/déconnexion moteur, découverte Bonjour, erreurs OSRM, actions
  WebSocket en échec. Visible dans Réglages → Journaux du moteur, onglet
  « App » (à côté de l'onglet « Moteur » qui montre les logs du moteur
  Go) — permet de diagnostiquer un souci côté téléphone sans Mac ni
  Console.app.

Le moteur Go est l'unique source de vérité et diffuse son état à **tous**
les clients connectés (desktop, iOS, headless via le hub WebSocket) — donc
piloter depuis le téléphone, le bureau ou un client headless reste
automatiquement cohérent, sans logique de sync supplémentaire à écrire ici.

Elle parle le même protocole WebSocket `{type, data}` que `tauri-app`
(`engine/internal/api/messages.go`), donc tout changement de contrat côté
moteur doit être répercuté ici aussi.

Cible de déploiement : **iOS 26.0** (Liquid Glass nécessite Xcode 26+ /
iPhone 11 ou SE 2e gen. minimum) — pas de souci de compatibilité ascendante
recherché ici, c'est une app personnelle.

## Build local (macOS + Xcode 26+ requis)

```bash
brew install xcodegen
cd ios-app
xcodegen generate
open GpsMockCompanion.xcodeproj
```

Le projet `.xcodeproj` est généré depuis `project.yml` (XcodeGen) — il n'est
jamais commité, ne l'éditez pas directement.

## CI (`.github/workflows/ios-build-ci.yml`)

Compile un `.ipa` **non signé** sur un runner `macos-latest` et le publie en
artifact. Pas de certificat ni de secret Apple à configurer : l'app est
pensée pour être installée via **AltStore**, qui la re-signe lui-même avec
un Apple ID gratuit au moment de l'installation (valable 7 jours, à
réinstaller/rafraîchir depuis AltStore quand le certificat expire).

## Utilisation

1. Récupérer le `.ipa` depuis l'artifact du workflow (Actions → run → Artifacts).
2. L'installer via AltStore/AltServer sur l'iPhone.
3. Autoriser l'accès à la localisation et au réseau local (popup iOS) :
   l'app cherche automatiquement le moteur en Bonjour. Sinon, saisir
   l'IP:port du PC manuellement (ex. `192.168.1.42:8080`).
4. **Appairer** : sur le PC, ouvrir Réglages → « Accès distant » pour
   afficher le code à 6 chiffres et le QR Code. Dans l'app, scanner le QR
   (Réglages → Connexion → « Scanner le QR Code ») — ou saisir le code dans
   le champ « Code d'appairage » — puis « Connecter ». Le token obtenu est
   mémorisé : les fois suivantes l'app se reconnecte seule, sans réappairage.
