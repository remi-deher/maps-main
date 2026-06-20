import SwiftUI
import CoreLocation
import MapKit

struct ContentView: View {
    @AppStorage("engineAddress") private var engineAddress: String = "192.168.1.1:8080"
    @StateObject private var location = LocationManager()
    @StateObject private var engine = EngineClient()
    @StateObject private var discovery = EngineDiscovery()

    @State private var reportTimer: Timer?
    @State private var pendingTap: CLLocationCoordinate2D?
    @State private var showAddFavorite = false
    @State private var newFavoriteName = ""
    @State private var showSettings = false
    @State private var cameraPosition: MapCameraPosition = .automatic

    @State private var searchQuery = ""
    @State private var searchResults: [MKMapItem] = []
    @State private var searchTask: Task<Void, Never>?
    @FocusState private var searchFocused: Bool

    private var spoofedCoordinate: CLLocationCoordinate2D? {
        guard let loc = engine.status?.lastInjectedLocation else { return nil }
        return CLLocationCoordinate2D(latitude: loc.lat, longitude: loc.lon)
    }

    var body: some View {
        ZStack(alignment: .top) {
            EngineMapView(spoofedLocation: spoofedCoordinate, cameraPosition: $cameraPosition) { coordinate in
                searchFocused = false
                pendingTap = coordinate
            }
            .ignoresSafeArea()

            VStack(spacing: 10) {
                OmniBar(query: $searchQuery, isFocused: $searchFocused) {
                    showSettings = true
                }
                SuggestionsPanel(
                    favorites: engine.status?.favorites ?? [],
                    searchResults: searchResults,
                    isSearching: !searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                    onSelectFavorite: { fav in
                        selectFavorite(fav)
                    },
                    onSelectResult: { item in
                        selectSearchResult(item)
                    },
                    onDeleteFavorite: { fav in
                        engine.removeFavorite(lat: fav.lat, lon: fav.lon)
                    }
                )
            }
            .padding(.top, 8)
        }
        .confirmationDialog(
            "Position sélectionnée",
            isPresented: Binding(get: { pendingTap != nil }, set: { if !$0 { pendingTap = nil } }),
            titleVisibility: .visible
        ) {
            if let tap = pendingTap {
                Button("Téléporter ici") {
                    engine.setLocation(lat: tap.latitude, lon: tap.longitude)
                    pendingTap = nil
                }
                Button("Lancer un trajet jusqu'ici") {
                    engine.playRoute(endLat: tap.latitude, endLon: tap.longitude, speed: 30, profile: "driving")
                    pendingTap = nil
                }
                Button("Ajouter aux favoris") {
                    showAddFavorite = true
                }
                Button("Annuler", role: .cancel) { pendingTap = nil }
            }
        }
        .alert("Nom du favori", isPresented: $showAddFavorite) {
            TextField("Nom", text: $newFavoriteName)
            Button("Enregistrer") {
                if let tap = pendingTap {
                    engine.addFavorite(lat: tap.latitude, lon: tap.longitude, name: newFavoriteName.isEmpty ? "Favori" : newFavoriteName)
                }
                newFavoriteName = ""
                pendingTap = nil
            }
            Button("Annuler", role: .cancel) {
                newFavoriteName = ""
                pendingTap = nil
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
        pendingTap = coordinate
        searchResults = []
        searchQuery = ""
        searchFocused = false
    }

    private func selectFavorite(_ fav: Favorite) {
        let coordinate = CLLocationCoordinate2D(latitude: fav.lat, longitude: fav.lon)
        engine.setLocation(lat: fav.lat, lon: fav.lon, name: fav.name ?? "Favori")
        focus(on: coordinate)
        searchFocused = false
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
