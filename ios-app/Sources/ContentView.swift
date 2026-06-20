import SwiftUI
import CoreLocation
import MapKit

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
    @AppStorage("engineAddress") private var engineAddress: String = "192.168.1.1:8080"
    @StateObject private var location = LocationManager()
    @StateObject private var engine = EngineClient()
    @StateObject private var discovery = EngineDiscovery()

    @State private var reportTimer: Timer?
    @State private var selectedPlace: SelectedPlace?
    @State private var showAddFavorite = false
    @State private var newFavoriteName = ""
    @State private var cameraPosition: MapCameraPosition = .userLocation(fallback: .automatic)

    @State private var searchQuery = ""
    @State private var searchResults: [MKMapItem] = []
    @State private var searchTask: Task<Void, Never>?
    @FocusState private var searchFocused: Bool

    @State private var itineraryStops: [RouteStop] = []
    @State private var itinerarySpeed: Double = 30
    @State private var itineraryProfile: String = "driving"
    @State private var legEstimates: [UUID: LegEstimate] = [:]
    @State private var estimatesTask: Task<Void, Never>?

    @State private var sheetDetent: PresentationDetent = .height(120)
    @State private var showSettings = false
    @State private var showConnectionError = false
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
                selectedPlace = SelectedPlace(
                    coordinate: coordinate,
                    title: "Position sélectionnée",
                    subtitle: String(format: "%.5f, %.5f", coordinate.latitude, coordinate.longitude)
                )
            }
            .ignoresSafeArea()

            VStack {
                HStack {
                    Spacer()
                    Button {
                        showSettings = true
                    } label: {
                        Image(systemName: "gearshape.fill")
                            .font(.system(size: 16, weight: .semibold))
                            .frame(width: 42, height: 42)
                    }
                    .buttonStyle(.glass)
                    .buttonBorderShape(.circle)
                    .clipShape(Circle())
                    .shadow(color: .black.opacity(0.12), radius: 10, y: 3)
                }
                Spacer()
            }
            .padding(.top, 8)
            .padding(.trailing, 16)

            if selectedPlace == nil {
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

            if let place = selectedPlace {
                PlaceCard(
                    place: place,
                    onTeleport: {
                        guard requireConnection() else { return }
                        engine.setLocation(lat: place.coordinate.latitude, lon: place.coordinate.longitude)
                        selectedPlace = nil
                    },
                    onRoute: {
                        guard requireConnection() else { return }
                        engine.playRoute(endLat: place.coordinate.latitude, endLon: place.coordinate.longitude, speed: 30, profile: "driving")
                        selectedPlace = nil
                    },
                    onAddStop: {
                        itineraryStops.append(RouteStop(coordinate: place.coordinate, name: place.title))
                        selectedPlace = nil
                    },
                    onFavorite: {
                        showAddFavorite = true
                    },
                    onDismiss: {
                        selectedPlace = nil
                    }
                )
                .padding(.bottom, 16)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.snappy, value: selectedPlace)
        .alert("Nom du favori", isPresented: $showAddFavorite) {
            TextField("Nom", text: $newFavoriteName)
            Button("Enregistrer") {
                if let place = selectedPlace, requireConnection() {
                    engine.addFavorite(lat: place.coordinate.latitude, lon: place.coordinate.longitude, name: newFavoriteName.isEmpty ? "Favori" : newFavoriteName)
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
                searchResults: searchResults,
                onSelectResult: selectSearchResult,
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
                onLoadLastItinerary: loadLastItinerary
            )
            .presentationDetents([.height(120), .medium, .large], selection: $sheetDetent)
            .presentationDragIndicator(.visible)
            .presentationBackgroundInteraction(.enabled)
            .interactiveDismissDisabled()
        }
        .sheet(isPresented: $showSettings) {
            SettingsSheet(
                engineAddress: $engineAddress,
                engine: engine,
                discovery: discovery,
                onToggleConnection: toggleConnection,
                onRetryDiscovery: startDiscovery
            )
        }
        .alert("Action impossible", isPresented: $showConnectionError) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(engine.lastError ?? "Le moteur n'est pas connecté. Vérifiez les réglages, votre itinéraire reste enregistré.")
        }
        .onAppear {
            location.requestPermission()
            startDiscovery()
        }
        .onChange(of: discovery.state) { newState in
            guard case .found(let host, let port) = newState else { return }
            engineAddress = "\(host):\(port)"
            if engine.state != .connected && engine.state != .connecting {
                toggleConnection()
            }
        }
        .onChange(of: searchQuery) { newValue in
            performSearch(newValue)
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
    }

    private func startDiscovery() {
        discovery.start()
    }

    private func performSearch(_ query: String) {
        searchTask?.cancel()
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            searchResults = []
            return
        }
        searchTask = Task {
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard !Task.isCancelled else { return }

            let request = MKLocalSearch.Request()
            request.naturalLanguageQuery = trimmed
            if let coordinate = location.lastLocation?.coordinate {
                request.region = MKCoordinateRegion(center: coordinate, latitudinalMeters: 50_000, longitudinalMeters: 50_000)
            }

            let search = MKLocalSearch(request: request)
            let items = (try? await search.start().mapItems) ?? []
            guard !Task.isCancelled else { return }
            await MainActor.run { searchResults = items }
        }
    }

    /// Picking a search result opens the same action menu as a long-press on
    /// the map (Téléporter / Itinéraire / Étape / Favori) instead of silently
    /// committing to an itinerary stop — the user decides what to do with
    /// the place once it's found.
    private func selectSearchResult(_ item: MKMapItem) {
        guard let coordinate = item.placemark.location?.coordinate else { return }
        searchResults = []
        searchQuery = ""
        searchFocused = false
        selectedPlace = SelectedPlace(coordinate: coordinate, title: item.name ?? "Lieu", subtitle: item.placemark.title)
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
                "speed": itinerarySpeed,
            ])
            previousCoordinate = stop.coordinate
        }
        engine.playSequence(legs: legs, looping: false)
        itineraryStops = []
    }

    /// Centralizes the "is the engine actually usable" check before any
    /// pilot action — surfaces a visible alert instead of the action
    /// silently no-oping (the original bug report).
    private func requireConnection() -> Bool {
        guard engine.state == .connected else {
            showConnectionError = true
            return false
        }
        return true
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

    /// Recomputes per-leg distance/ETA via MKDirections, keyed by destination
    /// stop id — mirrors the duration Plans shows under each leg of a trip.
    /// Real road-routing distance, not as-the-crow-flies, since the user
    /// picked "calcul via MKDirections" explicitly.
    private func recomputeLegEstimates(_ stops: [RouteStop]) {
        estimatesTask?.cancel()
        guard stops.count > 1 else {
            legEstimates = [:]
            return
        }
        let transportType: MKDirectionsTransportType = itineraryProfile == "walking" ? .walking : .automobile
        estimatesTask = Task {
            var results: [UUID: LegEstimate] = [:]
            for index in 1..<stops.count {
                guard !Task.isCancelled else { return }
                let origin = stops[index - 1]
                let destination = stops[index]
                let request = MKDirections.Request()
                request.source = MKMapItem(placemark: MKPlacemark(coordinate: origin.coordinate))
                request.destination = MKMapItem(placemark: MKPlacemark(coordinate: destination.coordinate))
                request.transportType = transportType
                if let route = try? await MKDirections(request: request).calculate().routes.first {
                    results[destination.id] = LegEstimate(distanceMeters: route.distance, travelTime: route.expectedTravelTime)
                }
            }
            guard !Task.isCancelled else { return }
            await MainActor.run { legEstimates = results }
        }
    }

    private func toggleConnection() {
        if engine.state == .connected || engine.state == .connecting {
            stopReporting()
            engine.disconnect()
            return
        }
        engine.connect(to: "ws://\(engineAddress)/ws")
        startReporting()
    }

    private func startReporting() {
        reportTimer?.invalidate()
        reportTimer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { _ in
            guard let loc = location.lastLocation else { return }
            engine.sendRealLocation(lat: loc.coordinate.latitude, lon: loc.coordinate.longitude)
        }
    }

    private func stopReporting() {
        reportTimer?.invalidate()
        reportTimer = nil
    }
}

#Preview {
    ContentView()
}
