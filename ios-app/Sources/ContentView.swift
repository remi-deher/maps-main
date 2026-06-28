import SwiftUI
import CoreLocation
import MapKit
import TipKit

struct ContentView: View {
    // Empty by default - an arbitrary placeholder IP used to read as a false
    // "already configured" state before Bonjour discovery had a chance to
    // run. See section 3.24 of docs/UI_UX_BASELINE.md.
    @AppStorage("engineAddress") var engineAddress: String = ""
    @State var session = MapSessionModel()
    @State var discovery = EngineDiscovery()
    @State var liveActivity = LiveActivityManager()
    @AppStorage("liveActivityEnabled") var liveActivityEnabled = true
    // Mirrors the engine's EveilMode/EveilInterval defaults (settings/schema.go)
    // - keeping them in sync means the iOS keep-alive cadence matches what the
    // desktop app and headless engine already assume "maintaining" means.
    @AppStorage("keepAliveEnabled") var keepAliveEnabled = true
    @AppStorage("keepAliveInterval") var keepAliveInterval: Double = 5
    @AppStorage("notificationsEnabled") var notificationsEnabled = true
    // Reused defaults, edited in Reglages (SettingsSheet binds the same keys).
    @AppStorage("defaultSpeed") var defaultSpeed: Double = 30
    @AppStorage("defaultProfile") var defaultProfile: String = "driving"
    @AppStorage("locationAccuracyMode") var locationAccuracyMode: String = "balanced"

    @State var selectedPlace: SelectedPlace?
    /// The system POI the user tapped on the map, if any. Resolved into a
    /// `selectedPlace` (and cleared) by an onChange below.
    @State var selectedFeature: MapFeature?
    @State var cameraPosition: MapCameraPosition = .userLocation(fallback: .automatic)
    @State var visibleRegion: MKCoordinateRegion?
    @State var recentPlaces: [RecentPlace] = []

    @State var searchQuery = ""
    @State var searchCompleter = SearchCompleter()
    @FocusState var searchFocused: Bool

    @State var itineraryStops: [RouteStop] = []
    @State var itinerarySpeed: Double = 30
    @State var itineraryProfile: String = "driving"
    @State var activeRoute: ActiveRoute?

    // Patrol-zone setup, promoted out of Reglages: `patrolMode` shows the
    // setup panel in the sheet and draws a live dashed preview on the map;
    // type/radius are the zone being defined (moved here from SettingsSheet).
    @State var patrolMode = false
    @State var patrolType = "circle"
    @State var patrolRadius: Double = 200

    // GPX import, promoted out of Reglages > Outils into the sheet: pick a
    // track, then a GpxPanel shows the file + a speed slider before launching.
    @State var showGpxImporter = false
    @State var gpxContent = ""
    @State var gpxFileName = ""
    @State var gpxSpeed: Double = 25
    @State var gpxError: String?

    @AppStorage("mapStyleChoice") var mapStyleChoiceRaw: String = MapStyleChoice.standard.rawValue

    @State var sheetDetent: SheetDetent = .collapsed
    @State var collapsedSheetHeight: CGFloat = BottomSheet.collapsedHeight
    @State var nativeSheetPresented = true
    @State var nativeSheetDetent: PresentationDetent = .height(72)
    @State var sheetScrollOffset: CGFloat = 0
    @State var isMapTilted = false
    @State var showSettings = false
    @State var hasSavedItinerary = UserDefaults.standard.data(forKey: lastItineraryKey) != nil

    private var spoofedCoordinate: CLLocationCoordinate2D? {
        guard let loc = session.engine.status?.lastInjectedLocation else { return nil }
        return CLLocationCoordinate2D(latitude: loc.lat, longitude: loc.lon)
    }

    private var routePreview: [CLLocationCoordinate2D] {
        if activeRoute != nil, isActiveRouteStatus(session.engine.status) {
            let enginePreview = (session.engine.status?.currentSequencePreview ?? []).map {
                CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon)
            }
            if !enginePreview.isEmpty {
                return enginePreview
            }
        }
        return activeRoute?.stops.map(\.coordinate) ?? []
    }

    private var displayedItineraryStops: [RouteStop] {
        activeRoute?.stops ?? itineraryStops
    }

    /// Where a circle patrol is centered: the current spoofed position if any,
    /// otherwise the device's real location (mirrors tauri-app's `currentPos`).
    var patrolCenter: CLLocationCoordinate2D? {
        spoofedCoordinate ?? session.location.lastLocation?.coordinate
    }

    /// The live dashed circle drawn on the map while defining a circle patrol.
    private var patrolPreview: (center: CLLocationCoordinate2D, radius: Double)? {
        guard patrolMode, patrolType == "circle", let center = patrolCenter else { return nil }
        return (center: center, radius: patrolRadius)
    }

    private struct LiveActivityKey: Equatable {
        let state: String?
        let name: String?
    }

    private var liveActivityKey: LiveActivityKey {
        LiveActivityKey(
            state: session.engine.status?.state,
            name: session.engine.status?.lastInjectedLocation?.name
        )
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            EngineMapView(
                spoofedLocation: spoofedCoordinate,
                routePreview: routePreview,
                itineraryStops: displayedItineraryStops,
                patrolZone: session.engine.status?.patrolZone,
                patrolPreview: patrolPreview,
                mapStyleChoice: mapStyleChoice,
                selectedFeature: $selectedFeature,
                cameraPosition: $cameraPosition,
                onLongPress: { coordinate in
                    searchFocused = false
                    MapLongPressTip().invalidate(reason: .actionPerformed)
                    Task {
                        let place = await reverseGeocode(coordinate)
                        await MainActor.run {
                            rememberRecentPlace(place)
                            selectedPlace = place
                        }
                    }
                },
                onRegionChange: { visibleRegion = $0 }
            )
            .ignoresSafeArea()
            .mapControls {
                MapCompass()
                MapScaleView()
            }

            GeometryReader { geo in
                mapChrome(safeArea: geo.safeAreaInsets, availableHeight: geo.size.height)
            }
        }
        .sheet(isPresented: $nativeSheetPresented) {
            bottomSheetContent(scrollOffset: $sheetScrollOffset)
                .presentationDetents(bottomSheetPresentationDetents, selection: $nativeSheetDetent)
                .presentationDragIndicator(.visible)
                .presentationBackgroundInteraction(.enabled)
                .presentationCornerRadius(26)
                .interactiveDismissDisabled(true)
        }
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Terminé") {
                    searchFocused = false
                }
            }
        }
        .onAppear {
            session.location.requestPermission()
            session.location.setAccuracyMode(locationAccuracyMode)
            if notificationsEnabled { NotificationManager.shared.requestPermission() }
            // Seed the itinerary builder with the user's default speed/profile.
            itinerarySpeed = defaultSpeed
            itineraryProfile = defaultProfile
            // Mirror the persisted keep-alive cadence into the engine so the
            // background location callback can throttle RELANCE without reading
            // SwiftUI state (unavailable while suspended).
            session.engine.keepAliveEnabled = keepAliveEnabled
            session.engine.keepAliveInterval = keepAliveInterval
            loadRecentPlaces()
            startDiscovery()
        }
        .onChange(of: locationAccuracyMode) { mode in
            session.location.setAccuracyMode(mode)
        }
        .onChange(of: keepAliveEnabled) { enabled in
            session.applyKeepAliveEnabled(enabled, interval: keepAliveInterval)
        }
        .onChange(of: keepAliveInterval) { interval in
            session.engine.keepAliveInterval = interval
        }
        .onChange(of: notificationsEnabled) { enabled in
            if enabled { NotificationManager.shared.requestPermission() }
        }
        .onChange(of: nativeSheetPresented) { isPresented in
            if !isPresented {
                nativeSheetPresented = true
            }
        }
        .onChange(of: nativeSheetDetent) { newDetent in
            syncSheetDetent(to: newDetent)
        }
        .onChange(of: sheetDetent) { newDetent in
            syncNativeSheetDetent(to: newDetent)
        }
        .onChange(of: session.engine.state) { _ in
            session.handleEngineStateChange(notificationsEnabled: notificationsEnabled)
        }
        .onChange(of: session.engine.status) { oldStatus, newStatus in
            session.handleSimulationStateChange(notificationsEnabled: notificationsEnabled)
            syncActiveRouteState(oldStatus: oldStatus, newStatus: newStatus)
        }
        .onChange(of: discovery.state) { newState in
            guard case .found(let host, let port) = newState else { return }
            // Only auto-fill when the user hasn't configured an address. A
            // manually entered (working, IPv4) address must not be clobbered by
            // a discovery result - the user explicitly chose it.
            if engineAddress.isEmpty {
                engineAddress = "\(host):\(port)"
            }
            if session.engine.state != .connected && session.engine.state != .connecting {
                toggleConnection()
            }
        }
        .onChange(of: searchQuery) { newValue in
            if let coordinate = session.location.lastLocation?.coordinate {
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
            session.recomputeLegEstimates(newStops, profile: itineraryProfile)
            if !newStops.isEmpty {
                withAnimation { sheetDetent = .medium }
            }
        }
        .onChange(of: itineraryProfile) { _ in
            session.recomputeLegEstimates(itineraryStops, profile: itineraryProfile)
        }
        .onChange(of: liveActivityKey) { key in
            liveActivity.sync(state: key.state, locationName: key.name, enabled: liveActivityEnabled)
        }
        .onChange(of: liveActivityEnabled) { enabled in
            liveActivity.sync(state: session.engine.status?.state, locationName: session.engine.status?.lastInjectedLocation?.name, enabled: enabled)
        }
        .onChange(of: selectedPlace) { place in
            // The place card now lives inside the bottom sheet (it used to
            // float over the map, where the sheet could end up covering it)
            // - expand the sheet so it's actually visible when set.
            if place != nil {
                withAnimation { sheetDetent = .medium }
            }
        }
        .onChange(of: selectedFeature) { _, feature in
            // Tapping a system POI resolves into the same SelectedPlace flow as
            // a long-press, so the user gets the identical action card
            // (Teleporter / Itineraire / Etape / Favori). Cleared immediately so
            // re-tapping the same POI works, and so the map's own selection
            // highlight doesn't linger once the card owns the interaction.
            guard let feature else { return }
            let coordsText = String(format: "%.5f, %.5f", feature.coordinate.latitude, feature.coordinate.longitude)
            let place = SelectedPlace(
                coordinate: feature.coordinate,
                title: feature.title ?? "Lieu",
                subtitle: coordsText
            )
            rememberRecentPlace(place)
            selectedPlace = place
            selectedFeature = nil
        }
    }

}

#Preview {
    ContentView()
}
