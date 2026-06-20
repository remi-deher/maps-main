import SwiftUI
import CoreLocation
import MapKit

struct ContentView: View {
    @AppStorage("engineAddress") private var engineAddress: String = "192.168.1.1:8080"
    @StateObject private var location = LocationManager()
    @StateObject private var engine = EngineClient()
    @StateObject private var discovery = EngineDiscovery()

    @State private var reportTimer: Timer?
    @State private var selectedPlace: SelectedPlace?
    @State private var showAddFavorite = false
    @State private var newFavoriteName = ""
    @State private var showSettings = false
    @State private var cameraPosition: MapCameraPosition = .userLocation(fallback: .automatic)

    @State private var searchQuery = ""
    @State private var searchResults: [MKMapItem] = []
    @State private var searchTask: Task<Void, Never>?
    @FocusState private var searchFocused: Bool

    private var spoofedCoordinate: CLLocationCoordinate2D? {
        guard let loc = engine.status?.lastInjectedLocation else { return nil }
        return CLLocationCoordinate2D(latitude: loc.lat, longitude: loc.lon)
    }

    private var routePreview: [CLLocationCoordinate2D] {
        (engine.status?.currentSequencePreview ?? []).map {
            CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon)
        }
    }

    private var isSearching: Bool {
        !searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            EngineMapView(
                spoofedLocation: spoofedCoordinate,
                routePreview: routePreview,
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

            VStack(spacing: 10) {
                OmniBar(query: $searchQuery, isFocused: $searchFocused) {
                    showSettings = true
                }

                if isSearching {
                    SuggestionsPanel(searchResults: searchResults) { item in
                        selectSearchResult(item)
                    }
                } else if let favorites = engine.status?.favorites, !favorites.isEmpty {
                    FavoriteChips(
                        favorites: favorites,
                        onSelect: { fav in selectFavorite(fav) },
                        onDelete: { fav in engine.removeFavorite(lat: fav.lat, lon: fav.lon) }
                    )
                }

                Spacer()

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
                }
            }
            .padding(.top, 8)
            .padding(.bottom, 16)

            if let place = selectedPlace {
                PlaceCard(
                    place: place,
                    onTeleport: {
                        engine.setLocation(lat: place.coordinate.latitude, lon: place.coordinate.longitude)
                        selectedPlace = nil
                    },
                    onRoute: {
                        engine.playRoute(endLat: place.coordinate.latitude, endLon: place.coordinate.longitude, speed: 30, profile: "driving")
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
                if let place = selectedPlace {
                    engine.addFavorite(lat: place.coordinate.latitude, lon: place.coordinate.longitude, name: newFavoriteName.isEmpty ? "Favori" : newFavoriteName)
                }
                newFavoriteName = ""
                selectedPlace = nil
            }
            Button("Annuler", role: .cancel) {
                newFavoriteName = ""
            }
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

    private func selectSearchResult(_ item: MKMapItem) {
        guard let coordinate = item.placemark.location?.coordinate else { return }
        focus(on: coordinate)
        selectedPlace = SelectedPlace(coordinate: coordinate, title: item.name ?? "Lieu", subtitle: item.placemark.title)
        searchResults = []
        searchQuery = ""
        searchFocused = false
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
