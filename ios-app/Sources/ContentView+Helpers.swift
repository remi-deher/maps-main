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
                selectedPlace = SelectedPlace(coordinate: coordinate, title: item.name ?? "Lieu", subtitle: item.placemark.title)
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

        let legType = itineraryProfile == "walking" ? "walk" : "drive"
        var legs: [[String: Any]] = []
        var previousCoordinate = itineraryStops[0].coordinate
        for (index, stop) in itineraryStops.enumerated() {
            let start = index == 0 ? stop.coordinate : previousCoordinate
            legs.append([
                "type": legType,
                "start": ["lat": start.latitude, "lon": start.longitude],
                "end": ["lat": stop.coordinate.latitude, "lon": stop.coordinate.longitude],
                "speed": itinerarySpeed
            ])
            previousCoordinate = stop.coordinate
        }
        engine.playSequence(legs: legs, looping: false)
        itineraryStops = []
    }

    /// Centralizes the "is the engine actually usable" check before any
    /// pilot action. Connection status now lives only in Réglages (the "État"
    /// row) to keep the search sheet as clean as Plans' — no inline banner and
    /// no modal alert on top of every blocked action (see §3.9 of
    /// docs/UI_UX_BASELINE.md), so a blocked action is a silent no-op here.
    func requireConnection() -> Bool {
        engine.state == .connected
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
        engine.setLocation(lat: fav.lat, lon: fav.lon, name: fav.name ?? "Favori")
        focus(on: coordinate)
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
        if let real = location.lastLocation?.coordinate {
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
        let minLat = latitudes.min()!
        let maxLat = latitudes.max()!
        let minLon = longitudes.min()!
        let maxLon = longitudes.max()!

        let center = CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLon + maxLon) / 2)
        // 1.6x padding so stops near the edge aren't flush against the screen
        // border, with a floor so two very close stops don't over-zoom.
        let span = MKCoordinateSpan(
            latitudeDelta: max((maxLat - minLat) * 1.6, 0.01),
            longitudeDelta: max((maxLon - minLon) * 1.6, 0.01)
        )
        return MKCoordinateRegion(center: center, span: span)
    }

    /// Recomputes per-leg distance/ETA via OSRM, keyed by destination stop id
    /// — mirrors the duration Plans shows under each leg of a trip, but uses
    /// the same router the engine itself uses to actually drive the
    /// simulation (engine/internal/engine/simulation.go), instead of
    /// MapKit/Apple Maps routing which can disagree on which road it picks.
    /// Falls back to MKDirections per-leg if OSRM is unreachable (offline
    /// demo server, no network) so estimates degrade rather than vanish.
    func recomputeLegEstimates(_ stops: [RouteStop]) {
        estimatesTask?.cancel()
        guard stops.count > 1 else {
            legEstimates = [:]
            return
        }
        let profile = itineraryProfile
        estimatesTask = Task {
            var results: [UUID: LegEstimate] = [:]
            for index in 1..<stops.count {
                guard !Task.isCancelled else { return }
                let origin = stops[index - 1]
                let destination = stops[index]
                if let route = await OSRMClient.fetchRoute(from: origin.coordinate, to: destination.coordinate, profile: profile) {
                    results[destination.id] = LegEstimate(distanceMeters: route.distanceMeters, travelTime: route.durationSeconds)
                } else if let fallback = await fetchMapKitEstimate(from: origin.coordinate, to: destination.coordinate, profile: profile) {
                    results[destination.id] = fallback
                }
            }
            guard !Task.isCancelled else { return }
            await MainActor.run { legEstimates = results }
        }
    }

    func fetchMapKitEstimate(from origin: CLLocationCoordinate2D, to destination: CLLocationCoordinate2D, profile: String) async -> LegEstimate? {
        let request = MKDirections.Request()
        request.source = MKMapItem(placemark: MKPlacemark(coordinate: origin))
        request.destination = MKMapItem(placemark: MKPlacemark(coordinate: destination))
        request.transportType = profile == "walking" ? .walking : .automobile
        guard let route = try? await MKDirections(request: request).calculate().routes.first else { return nil }
        AppLogger.shared.warn("OSRM indisponible, repli MKDirections pour l'estimation d'étape")
        return LegEstimate(distanceMeters: route.distance, travelTime: route.expectedTravelTime)
    }

    func toggleConnection() {
        if engine.state == .connected || engine.state == .connecting {
            stopReporting()
            stopKeepAlive()
            location.onLocationUpdate = nil
            engine.disconnect()
            return
        }
        engine.connect(to: "ws://\(engineAddress)/ws")
        startReporting()
        bindBackgroundKeepAlive()
        if keepAliveEnabled {
            location.requestAlwaysPermission()
            location.enableBackgroundUpdates(true)
            startKeepAlive()
        }
    }

    /// Routes every CoreLocation delivery through the engine. This is the path
    /// that survives suspension (the `Task.sleep` loops in startReporting/
    /// startKeepAlive don't): on each callback it rebuilds a dropped socket,
    /// reports the real position for the anti-drift shield, and re-asserts the
    /// spoof at the keep-alive cadence. Engine is captured weakly — it owns no
    /// reference back, so there's no cycle, and a torn-down engine just stops
    /// the callback.
    func bindBackgroundKeepAlive() {
        location.onLocationUpdate = { [weak engine] loc in
            guard let engine else { return }
            engine.ensureConnected()
            engine.sendRealLocationIfDue(lat: loc.coordinate.latitude, lon: loc.coordinate.longitude)
            engine.relanceIfDue()
        }
    }

    /// Drops the current connection and reopens it against the (possibly
    /// just-edited) `engineAddress` — used when the user changes the port in
    /// settings, mirroring tauri-app's "Appliquer" button for its engine
    /// port field (Sidebar.tsx's handleApplyEnginePort).
    func reconnect() {
        if engine.state == .connected || engine.state == .connecting {
            engine.disconnect()
        }
        engine.connect(to: "ws://\(engineAddress)/ws")
        startReporting()
        bindBackgroundKeepAlive()
    }

    /// Periodically re-sends RELANCE so the engine re-asserts the last
    /// injected position — the "maintien" the legacy background task
    /// (services/background.ts) achieved by posting to /api/relance on every
    /// background location tick. Runs independently of REAL_LOCATION
    /// reporting so it keeps the spoof alive even if the device's own GPS
    /// briefly drifts or the anti-drift shield hasn't re-injected yet.
    func startKeepAlive() {
        keepAliveTask?.cancel()
        keepAliveTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(max(keepAliveInterval, 1)))
                guard !Task.isCancelled, engine.state == .connected else { continue }
                // Same throttled path as the background location callback, so
                // foreground + background never double-fire RELANCE.
                engine.relanceIfDue()
            }
        }
    }

    func stopKeepAlive() {
        keepAliveTask?.cancel()
        keepAliveTask = nil
    }

    /// Task-based instead of `Timer.scheduledTimer`: a Timer keeps firing
    /// (and keeps a strong RunLoop reference alive) regardless of the view's
    /// lifecycle, whereas this Task is owned by `reportTask` and is
    /// cancelled explicitly in `stopReporting()` — see §3.22 of
    /// docs/UI_UX_BASELINE.md.
    func startReporting() {
        reportTask?.cancel()
        reportTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(10))
                guard !Task.isCancelled, let loc = location.lastLocation else { continue }
                engine.sendRealLocationIfDue(lat: loc.coordinate.latitude, lon: loc.coordinate.longitude)
            }
        }
    }

    func stopReporting() {
        reportTask?.cancel()
        reportTask = nil
    }
}
