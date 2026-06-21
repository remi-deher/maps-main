import SwiftUI
import CoreLocation
import MapKit
import TipKit

struct ContentView: View {
    // Empty by default — an arbitrary placeholder IP used to read as a false
    // "already configured" state before Bonjour discovery had a chance to
    // run. See §3.24 of docs/UI_UX_BASELINE.md.
    @AppStorage("engineAddress") var engineAddress: String = ""
    @StateObject var location = LocationManager()
    @StateObject var engine = EngineClient()
    @StateObject var discovery = EngineDiscovery()
    @StateObject var liveActivity = LiveActivityManager()
    @AppStorage("liveActivityEnabled") var liveActivityEnabled = true
    // Mirrors the engine's EveilMode/EveilInterval defaults (settings/schema.go)
    // — keeping them in sync means the iOS keep-alive cadence matches what the
    // desktop app and headless engine already assume "maintaining" means.
    @AppStorage("keepAliveEnabled") var keepAliveEnabled = true
    @AppStorage("keepAliveInterval") var keepAliveInterval: Double = 5
    @AppStorage("notificationsEnabled") var notificationsEnabled = true

    @State var reportTask: Task<Void, Never>?
    @State var keepAliveTask: Task<Void, Never>?
    @State var wasConnected = false
    @State var lastSimulationState: String?
    @State var selectedPlace: SelectedPlace?
    @State var showAddFavorite = false
    @State var newFavoriteName = ""
    @State var cameraPosition: MapCameraPosition = .userLocation(fallback: .automatic)
    @State var visibleRegion: MKCoordinateRegion?

    @State var searchQuery = ""
    @StateObject var searchCompleter = SearchCompleter()
    @FocusState var searchFocused: Bool

    @State var itineraryStops: [RouteStop] = []
    @State var itinerarySpeed: Double = 30
    @State var itineraryProfile: String = "driving"
    @State var legEstimates: [UUID: LegEstimate] = [:]
    @State var estimatesTask: Task<Void, Never>?

    @State var sheetDetent: PresentationDetent = .height(120)
    @State var showSettings = false
    @State var hasSavedItinerary = UserDefaults.standard.data(forKey: lastItineraryKey) != nil

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
                patrolZone: engine.status?.patrolZone,
                cameraPosition: $cameraPosition,
                onLongPress: { coordinate in
                    searchFocused = false
                    MapLongPressTip().invalidate(reason: .actionPerformed)
                    Task {
                        let place = await reverseGeocode(coordinate)
                        await MainActor.run { selectedPlace = place }
                    }
                },
                onRegionChange: { visibleRegion = $0 }
            )
            .popoverTip(MapLongPressTip())
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
                onApplyPort: reconnect,
                liveActivityEnabled: $liveActivityEnabled,
                keepAliveEnabled: $keepAliveEnabled,
                keepAliveInterval: $keepAliveInterval,
                notificationsEnabled: $notificationsEnabled,
                patrolCenter: spoofedCoordinate ?? location.lastLocation?.coordinate,
                visibleRegion: visibleRegion
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

}

#Preview {
    ContentView()
}
