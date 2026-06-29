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
    var legEstimates: [UUID: LegEstimate] = [:]

    var selectedPlace: SelectedPlace?
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

    var sheetDetent: SheetDetent = .collapsed
    var collapsedSheetHeight: CGFloat = BottomSheet.collapsedHeight
    var nativeSheetPresented = true
    var nativeSheetDetent: PresentationDetent = .height(72)
    var sheetScrollOffset: CGFloat = 0
    var isMapTilted = false
    var showSettings = false
    var hasSavedItinerary = UserDefaults.standard.data(forKey: lastItineraryKey) != nil

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
        return activeRoute?.stops.map(\.coordinate) ?? []
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
        return SelectedPlace(coordinate: coordinate, title: title.isEmpty ? coordsText : title, subtitle: coordsText)
    }

    func selectSearchSuggestion(_ completion: MKLocalSearchCompletion) {
        searchQuery = ""
        Task {
            guard let item = await searchCompleter.resolve(completion),
                  let coordinate = item.placemark.location?.coordinate else { return }
            await MainActor.run {
                let place = SelectedPlace(coordinate: coordinate, title: item.name ?? "Lieu", subtitle: item.placemark.title)
                rememberRecentPlace(place)
                selectedPlace = place
            }
        }
    }

    func launchItinerary(session: MapSessionModel) {
        guard !itineraryStops.isEmpty else { return }
        saveLastItinerary()
        guard requireConnection(session: session) else { return }

        let route = ActiveRoute(
            stops: itineraryStops,
            speed: itinerarySpeed,
            profile: itineraryProfile,
            legEstimates: session.legEstimates
        )
        playActiveRoute(route, session: session)
        activeRoute = route
        itineraryStops = []
        selectedPlace = nil
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
        fitItinerary(updatedRoute.stops, session: session)
        withAnimation { sheetDetent = .medium }
    }

    func playActiveRoute(_ route: ActiveRoute, session: MapSessionModel) {
        session.engine.playSequence(legs: sequenceLegs(for: route.stops, speed: route.speed, profile: route.profile, session: session), looping: false)
    }

    func sequenceLegs(for stops: [RouteStop], speed: Double, profile: String, session: MapSessionModel) -> [[String: Any]] {
        guard !stops.isEmpty else { return [] }
        let legType = profile == "walking" ? "walk" : "drive"
        let startingCoordinate = session.location.lastLocation?.coordinate ?? stops[0].coordinate
        var legs: [[String: Any]] = []
        var previousCoordinate = startingCoordinate
        for stop in stops {
            legs.append([
                "type": legType,
                "start": ["lat": previousCoordinate.latitude, "lon": previousCoordinate.longitude],
                "end": ["lat": stop.coordinate.latitude, "lon": stop.coordinate.longitude],
                "speed": speed
            ])
            previousCoordinate = stop.coordinate
        }
        return legs
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
        let saved = SavedItinerary(
            stops: itineraryStops.map { SavedStop(lat: $0.coordinate.latitude, lon: $0.coordinate.longitude, name: $0.name) },
            speed: itinerarySpeed,
            profile: itineraryProfile
        )
        guard let data = try? JSONEncoder().encode(saved) else { return }
        UserDefaults.standard.set(data, forKey: lastItineraryKey)
        hasSavedItinerary = true
    }

    func loadLastItinerary() {
        guard let data = UserDefaults.standard.data(forKey: lastItineraryKey),
              let saved = try? JSONDecoder().decode(SavedItinerary.self, from: data) else { return }
        itineraryStops = saved.stops.map {
            RouteStop(coordinate: CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon), name: $0.name)
        }
        itinerarySpeed = saved.speed
        itineraryProfile = saved.profile
    }

    func selectFavorite(_ fav: Favorite, session: MapSessionModel) {
        let coordinate = CLLocationCoordinate2D(latitude: fav.lat, longitude: fav.lon)
        rememberRecentPlace(SelectedPlace(coordinate: coordinate, title: fav.name ?? "Favori", subtitle: nil))
        session.engine.setLocation(lat: fav.lat, lon: fav.lon, name: fav.name ?? "Favori")
        focus(on: coordinate)
    }

    func selectRecentPlace(_ recent: RecentPlace) {
        selectedPlace = SelectedPlace(coordinate: recent.coordinate, title: recent.title, subtitle: recent.subtitle)
        focus(on: recent.coordinate)
    }

    func loadRecentPlaces() {
        guard let data = UserDefaults.standard.data(forKey: recentPlacesKey),
              let decoded = try? JSONDecoder().decode([RecentPlace].self, from: data) else {
            recentPlaces = []
            return
        }
        recentPlaces = decoded
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
        guard let data = try? JSONEncoder().encode(recentPlaces) else { return }
        UserDefaults.standard.set(data, forKey: recentPlacesKey)
    }

    func focus(on coordinate: CLLocationCoordinate2D) {
        withAnimation {
            cameraPosition = .region(MKCoordinateRegion(center: coordinate, latitudinalMeters: 800, longitudinalMeters: 800))
        }
    }

    func fitItinerary(_ stops: [RouteStop], session: MapSessionModel) {
        guard !stops.isEmpty else { return }
        var coordinates = stops.map(\.coordinate)
        if let real = session.location.lastLocation?.coordinate {
            coordinates.append(real)
        }
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

// Ensure these exist if they were only in ContentView+Helpers.swift
struct SavedStop: Codable {
    let lat: Double
    let lon: Double
    let name: String
}

struct SavedItinerary: Codable {
    let stops: [SavedStop]
    let speed: Double
    let profile: String
}

let lastItineraryKey = "lastItinerary"
let recentPlacesKey = "recentPlaces"
