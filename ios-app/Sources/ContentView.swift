import SwiftUI
import CoreLocation
import MapKit
import TipKit

/// Codable snapshot of an itinerary, persisted to UserDefaults so it survives
/// a disconnected-engine failure (or an app relaunch) — "charger le dernier
/// itinéraire" rebuilds the stops from this instead of the user retyping.
private struct SavedStop: Codable {
    let lat: Double
    let lon: Double
    let name: String
}

private struct SavedItinerary: Codable {
    let stops: [SavedStop]
    let speed: Double
    let profile: String
}

private let lastItineraryKey = "lastItinerary"

struct ContentView: View {
    // Empty by default — an arbitrary placeholder IP used to read as a false
    // "already configured" state before Bonjour discovery had a chance to
    // run. See §3.24 of docs/UI_UX_BASELINE.md.
    @AppStorage("engineAddress") private var engineAddress: String = ""
    @StateObject private var location = LocationManager()
    @StateObject private var engine = EngineClient()
    @StateObject private var discovery = EngineDiscovery()
    @StateObject private var liveActivity = LiveActivityManager()
    @AppStorage("liveActivityEnabled") private var liveActivityEnabled = true
    // Mirrors the engine's EveilMode/EveilInterval defaults (settings/schema.go)
    // — keeping them in sync means the iOS keep-alive cadence matches what the
    // desktop app and headless engine already assume "maintaining" means.
    @AppStorage("keepAliveEnabled") private var keepAliveEnabled = true
    @AppStorage("keepAliveInterval") private var keepAliveInterval: Double = 5
    @AppStorage("notificationsEnabled") private var notificationsEnabled = true

    @State private var reportTask: Task<Void, Never>?
    @State private var keepAliveTask: Task<Void, Never>?
    @State private var wasConnected = false
    @State private var lastSimulationState: String?
    @State private var selectedPlace: SelectedPlace?
    @State private var showAddFavorite = false
    @State private var newFavoriteName = ""
    @State private var cameraPosition: MapCameraPosition = .userLocation(fallback: .automatic)

    @State private var searchQuery = ""
    @StateObject private var searchCompleter = SearchCompleter()
    @FocusState private var searchFocused: Bool

    @State private var itineraryStops: [RouteStop] = []
    @State private var itinerarySpeed: Double = 30
    @State private var itineraryProfile: String = "driving"
    @State private var legEstimates: [UUID: LegEstimate] = [:]
    @State private var estimatesTask: Task<Void, Never>?

    @State private var sheetDetent: PresentationDetent = .height(120)
    @State private var showSettings = false
    @State private var hasSavedItinerary = UserDefaults.standard.data(forKey: lastItineraryKey) != nil

    private var spoofedCoordinate: CLLocationCoordinate2D? {
        guard let loc = engine.status?.lastInjectedLocation else { return nil }
        return CLLocationCoordinate2D(latitude: loc.lat, longitude: loc.lon)
    }

    private var routePreview: [CLLocationCoordinate2D] {
        (engine.status?.currentSequencePreview ?? []).map {
            CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon)
        }
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            EngineMapView(
                spoofedLocation: spoofedCoordinate,
                routePreview: routePreview,
                itineraryStops: itineraryStops,
                cameraPosition: $cameraPosition
            ) { coordinate in
                searchFocused = false
                MapLongPressTip().invalidate(reason: .actionPerformed)
                Task {
                    let place = await reverseGeocode(coordinate)
                    await MainActor.run { selectedPlace = place }
                }
            }
            .ignoresSafeArea()
            .mapControls {
                MapCompass()
                MapScaleView()
                MapPitchToggle()
            }

            // Both floating controls are glass siblings, so they share one
            // lensing pass and can morph together instead of each posing as
            // its own independent glass layer (swiftui-liquid-glass skill).
            GlassEffectContainer(spacing: 16) {
                VStack {
                    HStack {
                        Spacer()
                        Button {
                            showSettings = true
                        } label: {
                            Label("Réglages", systemImage: "gearshape.fill")
                                .labelStyle(.iconOnly)
                                .font(.title3.weight(.semibold))
                                .frame(width: 44, height: 44)
                        }
                        .buttonStyle(.glass)
                        .buttonBorderShape(.circle)
                        .popoverTip(MapLongPressTip())
                    }
                    Spacer()
                }
                .padding(.top, 8)
                .padding(.trailing, 16)

                HStack {
                    Spacer()
                    RecenterButton {
                        withAnimation {
                            cameraPosition = .userLocation(fallback: .automatic)
                        }
                    }
                }
                .padding(.trailing, 16)
                .padding(.bottom, 140)
            }
        }
        .alert("Nom du favori", isPresented: $showAddFavorite) {
            TextField("Nom", text: $newFavoriteName)
            Button("Enregistrer") {
                if let place = selectedPlace, requireConnection() {
                    engine.addFavorite(
                        lat: place.coordinate.latitude,
                        lon: place.coordinate.longitude,
                        name: newFavoriteName.isEmpty ? "Favori" : newFavoriteName
                    )
                }
                newFavoriteName = ""
                selectedPlace = nil
            }
            Button("Annuler", role: .cancel) {
                newFavoriteName = ""
            }
        }
        .sheet(isPresented: .constant(true)) {
            BottomSheet(
                searchQuery: $searchQuery,
                isFocused: $searchFocused,
                searchSuggestions: searchCompleter.results,
                onSelectSuggestion: selectSearchSuggestion,
                itineraryStops: $itineraryStops,
                itinerarySpeed: $itinerarySpeed,
                itineraryProfile: $itineraryProfile,
                legEstimates: legEstimates,
                onAddStop: { searchFocused = true },
                onLaunchItinerary: launchItinerary,
                favorites: engine.status?.favorites ?? [],
                onSelectFavorite: selectFavorite,
                onDeleteFavorite: { fav in engine.removeFavorite(lat: fav.lat, lon: fav.lon) },
                hasSavedItinerary: hasSavedItinerary,
                onLoadLastItinerary: loadLastItinerary,
                selectedPlace: selectedPlace,
                onPlaceTeleport: {
                    guard let place = selectedPlace, requireConnection() else { return }
                    engine.setLocation(lat: place.coordinate.latitude, lon: place.coordinate.longitude)
                    selectedPlace = nil
                },
                onPlaceRoute: {
                    guard let place = selectedPlace, requireConnection() else { return }
                    engine.playRoute(endLat: place.coordinate.latitude, endLon: place.coordinate.longitude, speed: 30, profile: "driving")
                    selectedPlace = nil
                },
                onPlaceAddStop: {
                    guard let place = selectedPlace else { return }
                    itineraryStops.append(RouteStop(coordinate: place.coordinate, name: place.title))
                    selectedPlace = nil
                },
                onPlaceFavorite: { showAddFavorite = true },
                onPlaceDismiss: { selectedPlace = nil },
                simulationState: engine.status?.state,
                onPauseRoute: { engine.pauseRoute() },
                onResumeRoute: { engine.resumeRoute() },
                onStopRoute: { engine.stopRoute() },
                isEngineConnected: engine.state == .connected,
                onConnect: { showSettings = true }
            )
            .presentationDetents([.height(120), .medium, .large], selection: $sheetDetent)
            .presentationDragIndicator(.visible)
            .presentationBackgroundInteraction(.enabled)
            .interactiveDismissDisabled()
        }
        // fullScreenCover instead of a second concurrent .sheet: two sheets
        // presented at once on the same hierarchy is fragile on iOS 26 (drag
        // indicator / presentationDetents conflicts) — see §3.11 of
        // docs/UI_UX_BASELINE.md. The persistent bottom sheet stays a sheet
        // (that pattern itself is correct), settings becomes a full-screen
        // cover instead of stacking on top of it.
        .fullScreenCover(isPresented: $showSettings) {
            SettingsSheet(
                engineAddress: $engineAddress,
                engine: engine,
                discovery: discovery,
                onToggleConnection: toggleConnection,
                onRetryDiscovery: startDiscovery,
                liveActivityEnabled: $liveActivityEnabled,
                keepAliveEnabled: $keepAliveEnabled,
                keepAliveInterval: $keepAliveInterval,
                notificationsEnabled: $notificationsEnabled
            )
        }
        .onAppear {
            location.requestPermission()
            if notificationsEnabled { NotificationManager.shared.requestPermission() }
            startDiscovery()
        }
        .onChange(of: keepAliveEnabled) { enabled in
            location.enableBackgroundUpdates(enabled)
            if enabled && engine.state == .connected { startKeepAlive() } else { stopKeepAlive() }
        }
        .onChange(of: notificationsEnabled) { enabled in
            if enabled { NotificationManager.shared.requestPermission() }
        }
        .onChange(of: engine.state) { newState in
            if newState == .connected {
                wasConnected = true
            } else if wasConnected && (newState == .reconnecting || newState == .disconnected) {
                wasConnected = false
                if notificationsEnabled { NotificationManager.shared.notifyDisconnect() }
            }
        }
        .onChange(of: engine.status?.state) { newState in
            let previous = lastSimulationState
            lastSimulationState = newState
            guard notificationsEnabled, let newState else { return }
            if newState == "ready" && (previous == "running" || previous == "moving") {
                NotificationManager.shared.notifyArrival(locationName: engine.status?.lastInjectedLocation?.name)
            }
        }
        .onChange(of: discovery.state) { newState in
            guard case .found(let host, let port) = newState else { return }
            engineAddress = "\(host):\(port)"
            if engine.state != .connected && engine.state != .connecting {
                toggleConnection()
            }
        }
        .onChange(of: searchQuery) { newValue in
            if let coordinate = location.lastLocation?.coordinate {
                searchCompleter.updateRegion(center: coordinate)
            }
            searchCompleter.queryFragment = newValue
        }
        .onChange(of: searchFocused) { focused in
            // Plans expands its sheet the moment you start typing, so results
            // aren't hidden under a collapsed handle.
            if focused {
                withAnimation { sheetDetent = .medium }
            }
        }
        .onChange(of: itineraryStops) { newStops in
            // Plans-style: adding (or removing/reordering) a stop reframes
            // the camera to show the whole itinerary, not just the new point.
            fitItinerary(newStops)
            recomputeLegEstimates(newStops)
            if !newStops.isEmpty {
                withAnimation { sheetDetent = .medium }
            }
        }
        .onChange(of: itineraryProfile) { _ in
            recomputeLegEstimates(itineraryStops)
        }
        .onChange(of: engine.status) { status in
            liveActivity.sync(state: status?.state, locationName: status?.lastInjectedLocation?.name, enabled: liveActivityEnabled)
        }
        .onChange(of: liveActivityEnabled) { enabled in
            liveActivity.sync(state: engine.status?.state, locationName: engine.status?.lastInjectedLocation?.name, enabled: enabled)
        }
        .onChange(of: selectedPlace) { place in
            // The place card now lives inside the bottom sheet (it used to
            // float over the map, where the sheet could end up covering it)
            // — expand the sheet so it's actually visible when set.
            if place != nil {
                withAnimation { sheetDetent = .medium }
            }
        }
    }

    /// Reverse-geocodes a long-press coordinate into a place name, so it
    /// reads the same as picking a search result instead of showing raw
    /// coordinates whenever a name is available — falls back to the
    /// coordinates only when geocoding fails (no network, ocean, etc).
    private func reverseGeocode(_ coordinate: CLLocationCoordinate2D) async -> SelectedPlace {
        let coordsText = String(format: "%.5f, %.5f", coordinate.latitude, coordinate.longitude)
        let location = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        guard let placemark = try? await CLGeocoder().reverseGeocodeLocation(location).first else {
            return SelectedPlace(coordinate: coordinate, title: coordsText, subtitle: nil)
        }
        let title = placemark.name ?? [placemark.thoroughfare, placemark.locality].compactMap { $0 }.joined(separator: ", ")
        return SelectedPlace(coordinate: coordinate, title: title.isEmpty ? coordsText : title, subtitle: coordsText)
    }

    private func startDiscovery() {
        discovery.start()
    }

    /// Picking a suggestion resolves it to a placemark (one `MKLocalSearch`
    /// call, only now — not on every keystroke) and opens the same action
    /// menu as a long-press on the map (Téléporter / Itinéraire / Étape /
    /// Favori) instead of silently committing to an itinerary stop — the
    /// user decides what to do with the place once it's found.
    private func selectSearchSuggestion(_ completion: MKLocalSearchCompletion) {
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
    private func launchItinerary() {
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
    /// pilot action. The persistent connection banner in BottomSheet already
    /// tells the user the engine is offline at all times — no need for a
    /// modal alert on top of every blocked action (see §3.9 of
    /// docs/UI_UX_BASELINE.md), so a blocked action is a silent no-op here.
    private func requireConnection() -> Bool {
        engine.state == .connected
    }

    private func saveLastItinerary() {
        let saved = SavedItinerary(
            stops: itineraryStops.map { SavedStop(lat: $0.coordinate.latitude, lon: $0.coordinate.longitude, name: $0.name) },
            speed: itinerarySpeed,
            profile: itineraryProfile
        )
        guard let data = try? JSONEncoder().encode(saved) else { return }
        UserDefaults.standard.set(data, forKey: lastItineraryKey)
        hasSavedItinerary = true
    }

    private func loadLastItinerary() {
        guard let data = UserDefaults.standard.data(forKey: lastItineraryKey),
              let saved = try? JSONDecoder().decode(SavedItinerary.self, from: data) else { return }
        itineraryStops = saved.stops.map {
            RouteStop(coordinate: CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon), name: $0.name)
        }
        itinerarySpeed = saved.speed
        itineraryProfile = saved.profile
    }

    private func selectFavorite(_ fav: Favorite) {
        let coordinate = CLLocationCoordinate2D(latitude: fav.lat, longitude: fav.lon)
        engine.setLocation(lat: fav.lat, lon: fav.lon, name: fav.name ?? "Favori")
        focus(on: coordinate)
    }

    private func focus(on coordinate: CLLocationCoordinate2D) {
        withAnimation {
            cameraPosition = .region(MKCoordinateRegion(center: coordinate, latitudinalMeters: 800, longitudinalMeters: 800))
        }
    }

    /// Reframes the camera so every stop (plus the device's real position,
    /// when known — itineraries start from wherever the phone actually is)
    /// fits on screen, instead of just zooming in on the latest addition.
    private func fitItinerary(_ stops: [RouteStop]) {
        guard !stops.isEmpty else { return }
        var coordinates = stops.map(\.coordinate)
        if let real = location.lastLocation?.coordinate {
            coordinates.append(real)
        }
        withAnimation {
            cameraPosition = .region(boundingRegion(for: coordinates))
        }
    }

    private func boundingRegion(for coordinates: [CLLocationCoordinate2D]) -> MKCoordinateRegion {
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
    private func recomputeLegEstimates(_ stops: [RouteStop]) {
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

    private func fetchMapKitEstimate(from origin: CLLocationCoordinate2D, to destination: CLLocationCoordinate2D, profile: String) async -> LegEstimate? {
        let request = MKDirections.Request()
        request.source = MKMapItem(placemark: MKPlacemark(coordinate: origin))
        request.destination = MKMapItem(placemark: MKPlacemark(coordinate: destination))
        request.transportType = profile == "walking" ? .walking : .automobile
        guard let route = try? await MKDirections(request: request).calculate().routes.first else { return nil }
        AppLogger.shared.warn("OSRM indisponible, repli MKDirections pour l'estimation d'étape")
        return LegEstimate(distanceMeters: route.distance, travelTime: route.expectedTravelTime)
    }

    private func toggleConnection() {
        if engine.state == .connected || engine.state == .connecting {
            stopReporting()
            stopKeepAlive()
            engine.disconnect()
            return
        }
        engine.connect(to: "ws://\(engineAddress)/ws")
        startReporting()
        if keepAliveEnabled {
            location.requestAlwaysPermission()
            location.enableBackgroundUpdates(true)
            startKeepAlive()
        }
    }

    /// Periodically re-sends RELANCE so the engine re-asserts the last
    /// injected position — the "maintien" the legacy background task
    /// (services/background.ts) achieved by posting to /api/relance on every
    /// background location tick. Runs independently of REAL_LOCATION
    /// reporting so it keeps the spoof alive even if the device's own GPS
    /// briefly drifts or the anti-drift shield hasn't re-injected yet.
    private func startKeepAlive() {
        keepAliveTask?.cancel()
        keepAliveTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(max(keepAliveInterval, 1)))
                guard !Task.isCancelled, engine.state == .connected else { continue }
                engine.relance()
            }
        }
    }

    private func stopKeepAlive() {
        keepAliveTask?.cancel()
        keepAliveTask = nil
    }

    /// Task-based instead of `Timer.scheduledTimer`: a Timer keeps firing
    /// (and keeps a strong RunLoop reference alive) regardless of the view's
    /// lifecycle, whereas this Task is owned by `reportTask` and is
    /// cancelled explicitly in `stopReporting()` — see §3.22 of
    /// docs/UI_UX_BASELINE.md.
    private func startReporting() {
        reportTask?.cancel()
        reportTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(10))
                guard !Task.isCancelled, let loc = location.lastLocation else { continue }
                engine.sendRealLocation(lat: loc.coordinate.latitude, lon: loc.coordinate.longitude)
            }
        }
    }

    private func stopReporting() {
        reportTask?.cancel()
        reportTask = nil
    }
}

#Preview {
    ContentView()
}
