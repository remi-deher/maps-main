import SwiftUI
import CoreLocation
import MapKit

@MainActor
@Observable
final class MapCoordinator {
    // MARK: - EngineClient Abstractions (Decoupling SwiftUI)

    func engineState(session: MapSessionModel) -> EngineConnectionState { session.engine.state }
    func engineStatusState(session: MapSessionModel) -> String? { session.engine.status?.state }
    func navigationState(session: MapSessionModel) -> String? { session.engine.status?.navigation?.status?.state }
    func lastInjectedLocationName(session: MapSessionModel) -> String? { session.engine.status?.lastInjectedLocation?.name }
    func patrolZone(session: MapSessionModel) -> PatrolZone? { session.engine.status?.patrolZone }

    func updateKeepAlive(session: MapSessionModel, enabled: Bool, interval: Double) {
        session.engine.keepAliveEnabled = enabled
        session.engine.keepAliveInterval = interval
    }

    func isDisconnected(session: MapSessionModel) -> Bool {
        session.engine.state != .connected && session.engine.state != .connecting
    }

    let estimator = ItineraryEstimator()
    private let persistence = MapPersistenceStore()
    private let playbackBuilder = ItineraryPlaybackBuilder()
    var legEstimates: [UUID: LegEstimate] = [:]
    // Real road geometry for the itinerary being planned (before launch), so
    // the map shows the actual route à la Plans instead of nothing / straight
    // lines. Populated by ItineraryEstimator alongside the ETAs.
    var plannedRoutePath: [CLLocationCoordinate2D] = []

    var selectedPlace: SelectedPlace?
    // Additional pins from a multi-result search ("restaurants near me" à la
    // Plans). The selected one is drawn as the primary red marker; the rest are
    // tappable secondary pins. Empty for a single-place selection.
    var searchResults: [SelectedPlace] = []
    var selectedFeature: MapFeature?
    var cameraPosition: MapCameraPosition = .userLocation(fallback: .automatic)
    var visibleRegion: MKCoordinateRegion?
    var recentPlaces: [RecentPlace] = []

    var searchQuery = ""
    var searchCompleter = SearchCompleter()

    // Dernière recherche plein texte et centre de carte au moment où elle a
    // tourné : servent à proposer « Rechercher dans cette zone » une fois que
    // l'utilisateur a suffisamment déplacé la carte (MapCoordinator+Search).
    var lastSearchQuery: String?
    var lastSearchCenter: CLLocationCoordinate2D?

    // Variantes de trajet pour une destination unique, la plus rapide en
    // premier. Voir MapCoordinator+RouteAlternatives.swift.
    var routeAlternatives: [OSRMRoute] = []
    var selectedAlternativeIndex = 0
    @ObservationIgnored var alternativesTask: Task<Void, Never>?

    var itineraryStops: [RouteStop] = []
    var itinerarySpeed: Double = 30
    var itineraryProfile: String = "driving"
    var activeRoute: ActiveRoute?

    var patrolMode = false
    var patrolType = "circle"
    var patrolRadius: Double = 200

    var showGpxImporter = false
    var gpxContent = ""
    var gpxFileName = ""
    var gpxSpeed: Double = 25
    var gpxError: String?

    // Camera-follow state cycled by the recenter button (à la Plans): off →
    // following the user → following with heading. Reset to `.off` whenever the
    // camera is moved programmatically (focus, itinerary fit, pitch toggle) so
    // the button icon honestly reflects whether we're tracking.
    enum FollowMode {
        case off
        case following
        case heading
    }
    var followMode: FollowMode = .off

    // Règle : on ne redimensionne la sheet que pour **révéler un panneau que
    // l'utilisateur doit voir pour agir** (fiche lieu, panneau GPX, panneau
    // patrouille, bandeau « moteur non connecté », itinéraire lancé). Tout le
    // reste laisse le détent où l'utilisateur l'a mis — chaque redimensionnement
    // gratuit est un saut qu'il n'a pas demandé, et Plans n'en fait que deux.
    var sheetDetent: SheetDetent = .collapsed

    // Part de la hauteur de carte que la sheet recouvre au détent courant.
    // Sert à deux choses : la safe area basse de la `Map` (pour que
    // l'attribution Apple reste visible) et le cadrage caméra ci-dessous, qui
    // reposait avant sur un facteur 0,32 codé en dur — juste au détent
    // `medium`, faux partout ailleurs.
    var sheetCoverage: CGFloat {
        switch sheetDetent {
        case .collapsed: return 0.12
        case .medium: return 0.43
        case .large: return 0.45
        }
    }
    var nativeSheetPresented = true
    var nativeSheetDetent: PresentationDetent = .height(BottomSheet.collapsedDetentHeight)
    var isMapTilted = false
    var showSettings = false
    // When true, the settings sheet opens straight to the diagnostics screen
    // (from "Signaler un problème") instead of the top-level category menu.
    var settingsOpenToDiagnostics = false
    var hasSavedItinerary = MapPersistenceStore().hasSavedItinerary

    // Derived from session (passed in where needed)
    func spoofedCoordinate(session: MapSessionModel) -> CLLocationCoordinate2D? {
        guard let loc = session.engine.status?.lastInjectedLocation else { return nil }
        return CLLocationCoordinate2D(latitude: loc.lat, longitude: loc.lon)
    }

    func routePreview(session: MapSessionModel) -> [CLLocationCoordinate2D] {
        if activeRoute != nil, isActiveRouteStatus(session: session) {
            let enginePreview = (session.engine.status?.currentSequencePreview ?? []).map {
                CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon)
            }
            if !enginePreview.isEmpty {
                return enginePreview
            }
        }
        if let activeRoute {
            return activeRoute.stops.map(\.coordinate)
        }
        // Planning phase: prefer the real road geometry, falling back to
        // straight segments between stops until OSRM/MapKit resolves.
        if !itineraryStops.isEmpty {
            return plannedRoutePath.isEmpty ? itineraryStops.map(\.coordinate) : plannedRoutePath
        }
        return []
    }

    var displayedItineraryStops: [RouteStop] {
        activeRoute?.stops ?? itineraryStops
    }

    func patrolCenter(session: MapSessionModel) -> CLLocationCoordinate2D? {
        spoofedCoordinate(session: session) ?? session.location.lastLocation?.coordinate
    }

    func patrolPreview(session: MapSessionModel) -> (center: CLLocationCoordinate2D, radius: Double)? {
        guard patrolMode, patrolType == "circle", let center = patrolCenter(session: session) else { return nil }
        return (center: center, radius: patrolRadius)
    }

    func reverseGeocode(_ coordinate: CLLocationCoordinate2D) async -> SelectedPlace {
        let coordsText = String(format: "%.5f, %.5f", coordinate.latitude, coordinate.longitude)
        let location = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        guard let placemark = try? await CLGeocoder().reverseGeocodeLocation(location).first else {
            return SelectedPlace(coordinate: coordinate, title: coordsText, subtitle: nil)
        }
        let title = placemark.name ?? [placemark.thoroughfare, placemark.locality].compactMap { $0 }.joined(separator: ", ")
        // Subtitle is a human address (street, city) — never raw lat/lon, which
        // Plans never surfaces to the user. The exact coordinates still live in
        // the place card's dedicated "Coordonnées GPS" row.
        let addressParts = [placemark.thoroughfare, placemark.locality].compactMap { $0 }.filter { !$0.isEmpty }
        let subtitle = addressParts.isEmpty ? nil : addressParts.joined(separator: ", ")
        return SelectedPlace(coordinate: coordinate, title: title.isEmpty ? coordsText : title, subtitle: subtitle)
    }

    func launchItinerary(session: MapSessionModel) {
        guard !itineraryStops.isEmpty else { return }
        saveLastItinerary()
        guard requireConnection(session: session) else { return }

        let route = ActiveRoute(
            stops: itineraryStops,
            speed: itinerarySpeed,
            profile: itineraryProfile,
            legEstimates: legEstimates
        )
        playActiveRoute(route, session: session)
        activeRoute = route
        itineraryStops = []
        plannedRoutePath = []
        clearRouteAlternatives()
        selectedPlace = nil
        searchResults = []
        fitItinerary(route.stops, session: session)
        withAnimation { sheetDetent = .medium }
    }

    func startRoute(to place: SelectedPlace, session: MapSessionModel, defaultSpeed: Double, defaultProfile: String) {
        guard requireConnection(session: session) else { return }
        let stop = RouteStop(coordinate: place.coordinate, name: place.title)
        let route = ActiveRoute(stops: [stop], speed: defaultSpeed, profile: defaultProfile, legEstimates: [:])
        session.engine.playRoute(
            endLat: place.coordinate.latitude,
            endLon: place.coordinate.longitude,
            speed: defaultSpeed,
            profile: defaultProfile
        )
        activeRoute = route
        selectedPlace = nil
        searchResults = []
        focus(on: place.coordinate)
        withAnimation { sheetDetent = .medium }
    }

    func addSelectedPlaceToActiveRoute(session: MapSessionModel) {
        guard let place = selectedPlace, let activeRoute = activeRoute, requireConnection(session: session) else { return }
        let stop = RouteStop(coordinate: place.coordinate, name: place.title)
        var updatedStops = activeRoute.stops
        updatedStops.insert(stop, at: 0)
        let updatedRoute = ActiveRoute(
            stops: updatedStops,
            speed: activeRoute.speed,
            profile: activeRoute.profile,
            legEstimates: [:]
        )
        playActiveRoute(updatedRoute, session: session)
        self.activeRoute = updatedRoute
        selectedPlace = nil
        searchResults = []
        fitItinerary(updatedRoute.stops, session: session)
    }

    func playActiveRoute(_ route: ActiveRoute, session: MapSessionModel) {
        // `stopsForPlayback` peut insérer un point de passage quand une variante
        // de trajet a été choisie : le moteur ne reçoit que des couples
        // début/fin et reroute lui-même, c'est le seul moyen de lui faire
        // suivre la variante. La liste affichée reste celle de l'utilisateur.
        let legs = playbackBuilder.sequenceLegs(
            for: stopsForPlayback(route.stops),
            speed: route.speed,
            profile: route.profile,
            startingCoordinate: session.location.lastLocation?.coordinate
        )
        session.engine.playSequence(legs: legs, looping: false)
    }

    func pauseActiveRoute(session: MapSessionModel) {
        session.engine.pauseRoute()
    }

    func resumeActiveRoute(session: MapSessionModel) {
        session.engine.resumeRoute()
    }

    func stopActiveRoute(session: MapSessionModel) {
        session.engine.stopRoute()
        activeRoute = nil
    }

    func showActiveRouteDetails() {
        withAnimation { sheetDetent = .large }
    }

    func recenterActiveRoute(session: MapSessionModel) {
        guard let activeRoute = activeRoute else { return }
        fitItinerary(activeRoute.stops, session: session)
    }

    func isRouteSimulationState(_ state: String?) -> Bool {
        state == "moving" || state == "paused" || state == "running"
    }

    func isActiveRouteStatus(session: MapSessionModel) -> Bool {
        let navigationState = session.engine.status?.navigation?.status?.state
        if navigationState == "running" || navigationState == "paused" {
            return true
        }
        if navigationState == "stopped" {
            return false
        }
        return isRouteSimulationState(session.engine.status?.state)
    }

    func syncActiveRouteState(
        oldEngineState: String?,
        newEngineState: String?,
        oldNavigationState: String?,
        newNavigationState: String?
    ) {
        guard activeRoute != nil else { return }

        if newNavigationState == "running" || newNavigationState == "paused" {
            return
        }
        if newNavigationState == "stopped" {
            activeRoute = nil
            return
        }

        if oldNavigationState != nil {
            return
        }

        let wasActive = isRouteSimulationState(oldEngineState)
        let isNowActive = isRouteSimulationState(newEngineState)
        if wasActive && !isNowActive {
            activeRoute = nil
        }
    }

    // Incrémenté à chaque action refusée faute de moteur — pilote le
    // `sensoryFeedback(.error)` de la sheet. Avant, `requireConnection` faisait
    // échouer l'action en silence : on tapait « Positionner ici » et il ne se
    // passait rien (docs/UI_UX_AUDIT_IOS_2026-09.md, P0-4).
    var actionBlockedFeedback = 0

    func requireConnection(session: MapSessionModel) -> Bool {
        if session.engine.state == .connected { return true }
        actionBlockedFeedback += 1
        // Déplie la sheet pour que le bandeau « Moteur non connecté » — qui
        // porte l'explication et le bouton Connecter — soit effectivement lu.
        if sheetDetent == .collapsed {
            withAnimation { sheetDetent = .medium }
        }
        return false
    }

    func saveLastItinerary() {
        if persistence.saveLastItinerary(stops: itineraryStops, speed: itinerarySpeed, profile: itineraryProfile) {
            hasSavedItinerary = true
        }
    }

    func loadLastItinerary() {
        guard let saved = persistence.loadLastItinerary() else { return }
        itineraryStops = saved.stops
        itinerarySpeed = saved.speed
        itineraryProfile = saved.profile
    }

    func selectFavorite(_ fav: Favorite, session: MapSessionModel) {
        let coordinate = CLLocationCoordinate2D(latitude: fav.lat, longitude: fav.lon)
        searchResults = []
        rememberRecentPlace(SelectedPlace(coordinate: coordinate, title: fav.name ?? "Favori", subtitle: nil))
        session.engine.setLocation(lat: fav.lat, lon: fav.lon, name: fav.name ?? "Favori")
        focus(on: coordinate)
    }

    func selectRecentPlace(_ recent: RecentPlace) {
        searchResults = []
        selectedPlace = SelectedPlace(coordinate: recent.coordinate, title: recent.title, subtitle: recent.subtitle)
        focus(on: recent.coordinate)
    }

    func loadRecentPlaces() {
        recentPlaces = persistence.loadRecentPlaces()
    }

    func rememberRecentPlace(_ place: SelectedPlace) {
        let recent = RecentPlace(
            lat: place.coordinate.latitude,
            lon: place.coordinate.longitude,
            title: place.title,
            subtitle: place.subtitle,
            timestamp: Int64(Date().timeIntervalSince1970)
        )
        var updated = recentPlaces.filter { $0.id != recent.id }
        updated.insert(recent, at: 0)
        recentPlaces = Array(updated.prefix(10))
        saveRecentPlaces()
    }

    func removeRecentPlace(_ recent: RecentPlace) {
        recentPlaces.removeAll { $0.id == recent.id }
        saveRecentPlaces()
    }

    func clearRecentPlaces() {
        recentPlaces = []
        saveRecentPlaces()
    }

    private func saveRecentPlaces() {
        persistence.saveRecentPlaces(recentPlaces)
    }

    func focus(on coordinate: CLLocationCoordinate2D, latitudinalMeters: CLLocationDistance = 800) {
        followMode = .off
        withAnimation {
            cameraPosition = .region(regionCenteringAboveSheet(on: coordinate, latitudinalMeters: latitudinalMeters))
        }
    }

    // Le point doit tomber au milieu de la bande de carte restée visible
    // au-dessus de la sheet, pas au milieu de l'écran. Le centre de la région
    // descend donc de la moitié de ce que la sheet recouvre — calculé depuis le
    // détent courant, ce qui rend le cadrage juste aux trois détents au lieu du
    // seul `medium`.
    func regionCenteringAboveSheet(
        on coordinate: CLLocationCoordinate2D,
        latitudinalMeters: CLLocationDistance
    ) -> MKCoordinateRegion {
        let southShiftMeters = latitudinalMeters * Double(sheetCoverage) / 2
        let center = CLLocationCoordinate2D(
            latitude: coordinate.latitude - southShiftMeters / 111_000,
            longitude: coordinate.longitude
        )
        return MKCoordinateRegion(
            center: center,
            latitudinalMeters: latitudinalMeters,
            longitudinalMeters: latitudinalMeters
        )
    }

    func fitItinerary(_ stops: [RouteStop], session: MapSessionModel) {
        guard !stops.isEmpty else { return }
        var coordinates = stops.map(\.coordinate)
        if let real = session.location.lastLocation?.coordinate {
            coordinates.append(real)
        }
        followMode = .off
        withAnimation {
            cameraPosition = .region(boundingRegion(for: coordinates))
        }
    }

    func boundingRegion(for coordinates: [CLLocationCoordinate2D]) -> MKCoordinateRegion {
        guard let first = coordinates.first else {
            return MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: 48.8566, longitude: 2.3522), latitudinalMeters: 800, longitudinalMeters: 800)
        }
        guard coordinates.count > 1 else {
            return MKCoordinateRegion(center: first, latitudinalMeters: 800, longitudinalMeters: 800)
        }

        let latitudes = coordinates.map(\.latitude)
        let longitudes = coordinates.map(\.longitude)
        guard let minLat = latitudes.min(), let maxLat = latitudes.max(),
              let minLon = longitudes.min(), let maxLon = longitudes.max() else {
            return MKCoordinateRegion(center: first, latitudinalMeters: 800, longitudinalMeters: 800)
        }

        // La sheet mange le bas de la carte : on dilate la hauteur de la région
        // pour que le contenu tienne dans la bande visible, puis on descend le
        // centre d'autant. Sans ça, cadrer un trajet le plaçait à cheval sur la
        // sheet — la moitié sud du tracé passait dessous.
        let visibleFraction = max(1 - Double(sheetCoverage), 0.3)
        let latitudeDelta = max((maxLat - minLat) * 1.6, 0.01) / visibleFraction
        let center = CLLocationCoordinate2D(
            latitude: (minLat + maxLat) / 2 - latitudeDelta * Double(sheetCoverage) / 2,
            longitude: (minLon + maxLon) / 2
        )
        let span = MKCoordinateSpan(
            latitudeDelta: latitudeDelta,
            longitudeDelta: max((maxLon - minLon) * 1.6, 0.01)
        )
        return MKCoordinateRegion(center: center, span: span)
    }

    func startPatrol(session: MapSessionModel) {
        if patrolType == "rectangle" {
            guard let region = visibleRegion else { return }
            let southWest = CLLocationCoordinate2D(
                latitude: region.center.latitude - region.span.latitudeDelta / 2,
                longitude: region.center.longitude - region.span.longitudeDelta / 2
            )
            let northEast = CLLocationCoordinate2D(
                latitude: region.center.latitude + region.span.latitudeDelta / 2,
                longitude: region.center.longitude + region.span.longitudeDelta / 2
            )
            session.engine.updatePatrolZone(type: "rectangle", center: nil, radius: nil, bounds: (southWest: southWest, northEast: northEast), active: true)
        } else {
            guard let center = patrolCenter(session: session) else { return }
            session.engine.updatePatrolZone(type: "circle", center: center, radius: patrolRadius, bounds: nil, active: true)
        }
    }

    func loadGpx(from url: URL) {
        gpxError = nil
        guard url.startAccessingSecurityScopedResource() else {
            gpxError = "Accès au fichier refusé."
            return
        }
        defer { url.stopAccessingSecurityScopedResource() }
        guard let text = try? String(contentsOf: url, encoding: .utf8), text.contains("<trkpt") else {
            gpxError = "Fichier GPX invalide ou vide."
            return
        }
        gpxContent = text
        gpxFileName = url.lastPathComponent
        withAnimation { sheetDetent = .medium }
    }
}
