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

    var sheetDetent: SheetDetent = .collapsed
    var collapsedSheetHeight: CGFloat = BottomSheet.collapsedHeight
    var nativeSheetPresented = true
    var nativeSheetDetent: PresentationDetent = .height(72)
    var sheetScrollOffset: CGFloat = 0
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
        withAnimation { sheetDetent = .medium }
    }

    func playActiveRoute(_ route: ActiveRoute, session: MapSessionModel) {
        let legs = playbackBuilder.sequenceLegs(
            for: route.stops,
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
        withAnimation { sheetDetent = .medium }
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

    func requireConnection(session: MapSessionModel) -> Bool {
        session.engine.state == .connected
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

    func clearRecentPlaces() {
        recentPlaces = []
        saveRecentPlaces()
    }

    private func saveRecentPlaces() {
        persistence.saveRecentPlaces(recentPlaces)
    }

    func focus(on coordinate: CLLocationCoordinate2D, latitudinalMeters: CLLocationDistance = 800) {
        // Shift the region center south so the point lands in the map area
        // *above* the bottom sheet (which covers ~43% of the screen at medium)
        // instead of being hidden underneath it — the same offset Plans applies
        // when it surfaces a place card.
        let southShift = latitudinalMeters * 0.32 / 111_000
        let center = CLLocationCoordinate2D(
            latitude: coordinate.latitude - southShift,
            longitude: coordinate.longitude
        )
        followMode = .off
        withAnimation {
            cameraPosition = .region(MKCoordinateRegion(center: center, latitudinalMeters: latitudinalMeters, longitudinalMeters: latitudinalMeters))
        }
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

        let center = CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLon + maxLon) / 2)
        let span = MKCoordinateSpan(
            latitudeDelta: max((maxLat - minLat) * 1.6, 0.01),
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
