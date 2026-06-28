import SwiftUI
import CoreLocation
import MapKit

// MARK: - Helper Structs
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
private let recentPlacesLimit = 10

// MARK: - ContentView Helpers Extension
extension ContentView {

    /// Reverse-geocodes a long-press coordinate into a place name, so it
    /// reads the same as picking a search result instead of showing raw
    /// coordinates whenever a name is available — falls back to the
    /// coordinates only when geocoding fails (no network, ocean, etc).
    func reverseGeocode(_ coordinate: CLLocationCoordinate2D) async -> SelectedPlace {
        let coordsText = String(format: "%.5f, %.5f", coordinate.latitude, coordinate.longitude)
        let location = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        guard let placemark = try? await CLGeocoder().reverseGeocodeLocation(location).first else {
            return SelectedPlace(coordinate: coordinate, title: coordsText, subtitle: nil)
        }
        let title = placemark.name ?? [placemark.thoroughfare, placemark.locality].compactMap { $0 }.joined(separator: ", ")
        return SelectedPlace(coordinate: coordinate, title: title.isEmpty ? coordsText : title, subtitle: coordsText)
    }

    func startDiscovery() {
        discovery.start()
    }

    /// Picking a suggestion resolves it to a placemark (one `MKLocalSearch`
    /// call, only now — not on every keystroke) and opens the same action
    /// menu as a long-press on the map (Téléporter / Itinéraire / Étape /
    /// Favori) instead of silently committing to an itinerary stop — the
    /// user decides what to do with the place once it's found.
    func selectSearchSuggestion(_ completion: MKLocalSearchCompletion) {
        searchQuery = ""
        searchFocused = false
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

    /// Mirrors tauri-app's handlePlaySequence: each leg's start is the
    /// previous leg's end, chaining the stops into one continuous itinerary.
    /// Saves the itinerary before attempting to send it — if the engine
    /// isn't connected, the stops stay on screen (not cleared) and the user
    /// can retry, or reload this same snapshot later via "Charger le dernier
    /// itinéraire" even after leaving the screen.
    func launchItinerary() {
        guard !itineraryStops.isEmpty else { return }
        saveLastItinerary()
        guard requireConnection() else { return }

        let route = ActiveRoute(
            stops: itineraryStops,
            speed: itinerarySpeed,
            profile: itineraryProfile,
            legEstimates: session.legEstimates
        )
        playActiveRoute(route)
        activeRoute = route
        itineraryStops = []
        selectedPlace = nil
        searchFocused = false
        fitItinerary(route.stops)
        withAnimation { sheetDetent = .medium }
    }

    func startRoute(to place: SelectedPlace) {
        guard requireConnection() else { return }
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
        searchFocused = false
        focus(on: place.coordinate)
        withAnimation { sheetDetent = .medium }
    }

    func addSelectedPlaceToActiveRoute() {
        guard let place = selectedPlace, let activeRoute = activeRoute, requireConnection() else { return }
        let stop = RouteStop(coordinate: place.coordinate, name: place.title)
        var updatedStops = activeRoute.stops
        updatedStops.insert(stop, at: 0)
        let updatedRoute = ActiveRoute(
            stops: updatedStops,
            speed: activeRoute.speed,
            profile: activeRoute.profile,
            legEstimates: [:]
        )
        playActiveRoute(updatedRoute)
        self.activeRoute = updatedRoute
        selectedPlace = nil
        searchFocused = false
        fitItinerary(updatedRoute.stops)
        withAnimation { sheetDetent = .medium }
    }

    func playActiveRoute(_ route: ActiveRoute) {
        session.engine.playSequence(legs: sequenceLegs(for: route.stops, speed: route.speed, profile: route.profile), looping: false)
    }

    func sequenceLegs(for stops: [RouteStop], speed: Double, profile: String) -> [[String: Any]] {
        guard !stops.isEmpty else { return [] }
        let legType = profile == "walking" ? "walk" : "drive"
        var legs: [[String: Any]] = []
        var previousCoordinate = stops[0].coordinate
        for (index, stop) in stops.enumerated() {
            let start = index == 0 ? stop.coordinate : previousCoordinate
            legs.append([
                "type": legType,
                "start": ["lat": start.latitude, "lon": start.longitude],
                "end": ["lat": stop.coordinate.latitude, "lon": stop.coordinate.longitude],
                "speed": speed
            ])
            previousCoordinate = stop.coordinate
        }
        return legs
    }

    func pauseActiveRoute() {
        session.engine.pauseRoute()
    }

    func resumeActiveRoute() {
        session.engine.resumeRoute()
    }

    func stopActiveRoute() {
        session.engine.stopRoute()
        activeRoute = nil
        withAnimation { sheetDetent = .medium }
    }

    func showActiveRouteDetails() {
        withAnimation { sheetDetent = .large }
    }

    func recenterActiveRoute() {
        guard let activeRoute = activeRoute else { return }
        fitItinerary(activeRoute.stops)
    }

    func syncActiveRouteState(oldState: String?, newState: String?) {
        guard activeRoute != nil else { return }
        guard let newState = newState else { return }
        
        let wasActive = (oldState == "moving" || oldState == "paused")
        let isNowActive = (newState == "moving" || newState == "paused")
        
        if wasActive && !isNowActive {
            activeRoute = nil
        }
    }

    /// Centralizes the "is the engine actually usable" check before any
    /// pilot action. Connection status now lives only in Réglages (the "État"
    /// row) to keep the search sheet as clean as Plans' — no inline banner and
    /// no modal alert on top of every blocked action (see §3.9 of
    /// docs/UI_UX_BASELINE.md), so a blocked action is a silent no-op here.
    func requireConnection() -> Bool {
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

    func selectFavorite(_ fav: Favorite) {
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
        recentPlaces = Array(updated.prefix(recentPlacesLimit))
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

    /// Reframes the camera so every stop (plus the device's real position,
    /// when known — itineraries start from wherever the phone actually is)
    /// fits on screen, instead of just zooming in on the latest addition.
    func fitItinerary(_ stops: [RouteStop]) {
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
        // 1.6x padding so stops near the edge aren't flush against the screen
        // border, with a floor so two very close stops don't over-zoom.
        let span = MKCoordinateSpan(
            latitudeDelta: max((maxLat - minLat) * 1.6, 0.01),
            longitudeDelta: max((maxLon - minLon) * 1.6, 0.01)
        )
        return MKCoordinateRegion(center: center, span: span)
    }

    /// Starts a circle patrol centered on the current spoofed/real position, or
    /// a rectangle patrol using the map's current visible bounds — moved out of
    /// SettingsSheet so the zone is defined against the map (with the live
    /// dashed preview) instead of blind in a settings form. A missing center or
    /// region is a silent no-op (center almost always resolves via the real
    /// location fallback in `patrolCenter`).
    func startPatrol() {
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
            guard let center = patrolCenter else { return }
            session.engine.updatePatrolZone(type: "circle", center: center, radius: patrolRadius, bounds: nil, active: true)
        }
    }

    /// Reads a picked .gpx file into `gpxContent` so the sheet can show the
    /// GpxPanel (file + speed + launch). Moved out of SettingsSheet so GPX
    /// import lives with the other "start a simulation" actions. Expands the
    /// sheet so the just-loaded panel is actually visible.
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

    func toggleConnection() {
        session.toggleConnection(engineAddress: engineAddress, keepAliveEnabled: keepAliveEnabled)
    }

    /// Drops the current connection and reopens it against the (possibly
    /// just-edited) `engineAddress` — used when the user changes the port in
    /// settings, mirroring tauri-app's "Appliquer" button for its engine
    /// port field (Sidebar.tsx's handleApplyEnginePort).
    func reconnect() {
        session.reconnect(engineAddress: engineAddress)
    }
}
