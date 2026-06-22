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
    // Reused defaults, edited in Réglages (SettingsSheet binds the same keys).
    @AppStorage("defaultSpeed") var defaultSpeed: Double = 30
    @AppStorage("defaultProfile") var defaultProfile: String = "driving"
    @AppStorage("locationAccuracyMode") var locationAccuracyMode: String = "balanced"

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

    @State var sheetDetent: PresentationDetent = .height(BottomSheet.collapsedHeight)
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
            .ignoresSafeArea()
            .mapControls {
                MapCompass()
                MapScaleView()
                MapPitchToggle()
            }

            // The settings gear now lives inside the search capsule's trailing
            // edge (BottomSheet.trailingButton), Plans-style — so the only
            // floating control left over the map is recenter.
            GlassEffectContainer(spacing: 16) {
                VStack(alignment: .trailing, spacing: 10) {
                    // TipView instead of .popoverTip: a popover's source view
                    // would have to be the map itself, but the map fills the
                    // whole screen (.ignoresSafeArea() below) — TipKit then
                    // has no real anchor rect to avoid and can render its
                    // bubble right over the search bar, swallowing its first
                    // tap. A TipView has a fixed, bounded frame instead, so it
                    // can't cover anything else.
                    TipView(MapLongPressTip(), arrowEdge: .top)
                        .frame(maxWidth: 280)
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
                    engine.playRoute(endLat: place.coordinate.latitude, endLon: place.coordinate.longitude, speed: defaultSpeed, profile: defaultProfile)
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
                onOpenSettings: { showSettings = true },
                sheetDetent: sheetDetent
            )
            .presentationDetents([.height(BottomSheet.collapsedHeight), .medium, .large], selection: $sheetDetent)
            .presentationDragIndicator(.visible)
            .presentationBackgroundInteraction(.enabled)
            .interactiveDismissDisabled()
            // Settings are presented FROM the bottom sheet, not from
            // ContentView. The bottom sheet is permanently presented via
            // `.sheet(isPresented: .constant(true))`, and a single view
            // controller can only present one modal at a time — attaching the
            // settings presentation to ContentView (as a .sheet or
            // .fullScreenCover) put it on the same presenter that the bottom
            // sheet already occupies, so it silently never appeared and the
            // gear button looked dead. Presented here, it stacks as a child of
            // the already-presented sheet (parent → child), which is fully
            // supported on iOS 26. SettingsSheet uses no presentationDetents,
            // so there's no drag-indicator / detent conflict (§3.11 of
            // docs/UI_UX_BASELINE.md).
            .sheet(isPresented: $showSettings) {
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
                    visibleRegion: visibleRegion,
                    locationAuthorization: location.authorizationStatus
                )
            }
        }
        .onAppear {
            location.requestPermission()
            location.setAccuracyMode(locationAccuracyMode)
            if notificationsEnabled { NotificationManager.shared.requestPermission() }
            // Seed the itinerary builder with the user's default speed/profile.
            itinerarySpeed = defaultSpeed
            itineraryProfile = defaultProfile
            // Mirror the persisted keep-alive cadence into the engine so the
            // background location callback can throttle RELANCE without reading
            // SwiftUI state (unavailable while suspended).
            engine.keepAliveEnabled = keepAliveEnabled
            engine.keepAliveInterval = keepAliveInterval
            startDiscovery()
        }
        .onChange(of: locationAccuracyMode) { mode in
            location.setAccuracyMode(mode)
        }
        .onChange(of: keepAliveEnabled) { enabled in
            engine.keepAliveEnabled = enabled
            location.enableBackgroundUpdates(enabled)
            if enabled {
                // Turning keep-alive on after connecting needs the Always grant
                // too, otherwise background callbacks never fire.
                location.requestAlwaysPermission()
                if engine.state == .connected { startKeepAlive() }
            } else {
                stopKeepAlive()
            }
        }
        .onChange(of: keepAliveInterval) { interval in
            engine.keepAliveInterval = interval
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
            // Plans expands its sheet the moment you start typing, so results
            // aren't hidden under a collapsed handle. Triggered by the query
            // itself rather than `searchFocused`: expanding the sheet the
            // instant the field is tapped raced the keyboard's own slide-up
            // animation (both resize/reposition the same view hierarchy at
            // once), which made the keyboard visibly slow to appear.
            if !newValue.isEmpty {
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
