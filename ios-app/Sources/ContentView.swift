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
    @State private var focusRequest: MapFocusRequest?

    @State private var searchQuery = ""
    @State private var searchResults: [MKMapItem] = []
    @State private var searchTask: Task<Void, Never>?

    private var spoofedCoordinate: CLLocationCoordinate2D? {
        guard let loc = engine.status?.lastInjectedLocation else { return nil }
        return CLLocationCoordinate2D(latitude: loc.lat, longitude: loc.lon)
    }

    var body: some View {
        EngineMapView(spoofedLocation: spoofedCoordinate, focusRequest: focusRequest) { coordinate in
            pendingTap = coordinate
        }
        .ignoresSafeArea()
        .sheet(isPresented: .constant(true)) {
            controlSheet
                .presentationDetents([.height(140), .medium, .large])
                .presentationBackgroundInteraction(.enabled)
                .interactiveDismissDisabled()
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
    }

    private var controlSheet: some View {
        NavigationView {
            List {
                Section("Moteur GPS-Mock") {
                    discoveryRow

                    TextField("IP:port", text: $engineAddress)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)

                    HStack {
                        Text("État")
                        Spacer()
                        Text(engine.state.rawValue)
                            .foregroundStyle(engine.state == .connected ? .green : .secondary)
                    }

                    if let drift = engine.status?.lastRealLocation?.drift {
                        HStack {
                            Text("Dérive")
                            Spacer()
                            Text("\(Int(drift)) m")
                                .foregroundStyle(drift > 100 ? .orange : .green)
                        }
                    }

                    if let error = engine.lastError {
                        Text(error).font(.caption).foregroundStyle(.red)
                    }

                    Button(engine.state == .connected || engine.state == .connecting ? "Déconnecter" : "Connecter") {
                        toggleConnection()
                    }
                }

                if !searchQuery.isEmpty {
                    Section("Résultats") {
                        if searchResults.isEmpty {
                            Text("Recherche...").foregroundStyle(.secondary)
                        } else {
                            ForEach(Array(searchResults.enumerated()), id: \.offset) { _, item in
                                Button {
                                    selectSearchResult(item)
                                } label: {
                                    VStack(alignment: .leading) {
                                        Text(item.name ?? "Lieu")
                                            .foregroundStyle(Color.primary)
                                        if let address = item.placemark.title {
                                            Text(address)
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                Section("Favoris") {
                    let favorites = engine.status?.favorites ?? []
                    if favorites.isEmpty {
                        Text("Aucun favori.").foregroundStyle(.secondary)
                    } else {
                        ForEach(favorites) { fav in
                            Button {
                                engine.setLocation(lat: fav.lat, lon: fav.lon, name: fav.name ?? "Favori")
                                focusRequest = MapFocusRequest(coordinate: CLLocationCoordinate2D(latitude: fav.lat, longitude: fav.lon))
                            } label: {
                                VStack(alignment: .leading) {
                                    Text(fav.name ?? "Favori")
                                        .foregroundStyle(Color.primary)
                                    Text("\(fav.lat, specifier: "%.5f"), \(fav.lon, specifier: "%.5f")")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .swipeActions {
                                Button("Supprimer", role: .destructive) {
                                    engine.removeFavorite(lat: fav.lat, lon: fav.lon)
                                }
                            }
                        }
                    }
                }

                Section {
                    Text("Cherchez une adresse, ou touchez la carte, pour téléporter, lancer un trajet ou ajouter un favori. La position réelle est envoyée toutes les 10s pour le bouclier anti-dérive.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("GPS-Mock")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $searchQuery, prompt: "Rechercher une adresse")
            .onChange(of: searchQuery) { newValue in
                performSearch(newValue)
            }
        }
    }

    @ViewBuilder
    private var discoveryRow: some View {
        switch discovery.state {
        case .idle:
            EmptyView()
        case .searching:
            HStack {
                ProgressView().controlSize(.small)
                Text("Recherche du moteur sur le réseau...")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        case .found(let host, let port):
            HStack {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                Text("Trouvé : \(host):\(port)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        case .notFound:
            HStack {
                Image(systemName: "wifi.exclamationmark").foregroundStyle(.orange)
                Text("Moteur introuvable automatiquement, saisissez l'adresse")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Réessayer") { startDiscovery() }
                    .font(.caption)
            }
        }
    }

    private func startDiscovery() {
        discovery.start()
        // Auto-fill + auto-connect happens in the onChange(of: discovery.state)
        // handler above once a result comes in.
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
        pendingTap = coordinate
        focusRequest = MapFocusRequest(coordinate: coordinate)
        searchResults = []
        searchQuery = ""
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
