import SwiftUI
import CoreLocation
import MapKit
import TipKit
import UniformTypeIdentifiers

struct ContentView: View {
    // Empty by default — an arbitrary placeholder IP used to read as a false
    // "already configured" state before Bonjour discovery had a chance to
    // run. See §3.24 of docs/UI_UX_BASELINE.md.
    @AppStorage("engineAddress") var engineAddress: String = ""
    @State var session = MapSessionModel()
    @State var discovery = EngineDiscovery()
    @State var liveActivity = LiveActivityManager()
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

    @State var selectedPlace: SelectedPlace?
    /// The system POI the user tapped on the map, if any. Resolved into a
    /// `selectedPlace` (and cleared) by an onChange below.
    @State var selectedFeature: MapFeature?
    @State var showAddFavorite = false
    @State var newFavoriteName = ""
    @State var cameraPosition: MapCameraPosition = .userLocation(fallback: .automatic)
    @State var visibleRegion: MKCoordinateRegion?

    @State var searchQuery = ""
    @State var searchCompleter = SearchCompleter()
    @FocusState var searchFocused: Bool

    @State var itineraryStops: [RouteStop] = []
    @State var itinerarySpeed: Double = 30
    @State var itineraryProfile: String = "driving"

    // Patrol-zone setup, promoted out of Réglages: `patrolMode` shows the
    // setup panel in the sheet and draws a live dashed preview on the map;
    // type/radius are the zone being defined (moved here from SettingsSheet).
    @State var patrolMode = false
    @State var patrolType = "circle"
    @State var patrolRadius: Double = 200

    // GPX import, promoted out of Réglages › Outils into the sheet: pick a
    // track, then a GpxPanel shows the file + a speed slider before launching.
    @State var showGpxImporter = false
    @State var gpxContent = ""
    @State var gpxFileName = ""
    @State var gpxSpeed: Double = 25
    @State var gpxError: String?

    @AppStorage("mapStyleChoice") var mapStyleChoiceRaw: String = MapStyleChoice.standard.rawValue
    private var mapStyleChoice: MapStyleChoice {
        MapStyleChoice(rawValue: mapStyleChoiceRaw) ?? .standard
    }

    @State var sheetDetent: SheetDetent = .collapsed
    @State var collapsedSheetHeight: CGFloat = BottomSheet.collapsedHeight
    @State var showSettings = false
    @State var hasSavedItinerary = UserDefaults.standard.data(forKey: lastItineraryKey) != nil

    private var spoofedCoordinate: CLLocationCoordinate2D? {
        guard let loc = session.engine.status?.lastInjectedLocation else { return nil }
        return CLLocationCoordinate2D(latitude: loc.lat, longitude: loc.lon)
    }

    private var routePreview: [CLLocationCoordinate2D] {
        (session.engine.status?.currentSequencePreview ?? []).map {
            CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon)
        }
    }

    /// Where a circle patrol is centered: the current spoofed position if any,
    /// otherwise the device's real location (mirrors tauri-app's `currentPos`).
    var patrolCenter: CLLocationCoordinate2D? {
        spoofedCoordinate ?? session.location.lastLocation?.coordinate
    }

    /// The live dashed circle drawn on the map while defining a circle patrol —
    /// nil for rectangle (its zone is the visible region, already on screen) or
    /// when not setting up.
    private var patrolPreview: (center: CLLocationCoordinate2D, radius: Double)? {
        guard patrolMode, patrolType == "circle", let center = patrolCenter else { return nil }
        return (center: center, radius: patrolRadius)
    }

    /// The only two fields of `EngineStatus` the Live Activity actually
    /// reflects. The engine pushes a full STATUS on every action *and* every
    /// telemetry tick (~every 5s), so observing `status` wholesale re-synced
    /// the Live Activity constantly for no reason; keying the onChange on this
    /// derived value collapses it to "only when the displayed state or
    /// destination changed". See §3 (perf) of docs/UI_UX_BASELINE.md.
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

    /// Plans-style layers control: a glass capsule menu to switch the map look
    /// (plan/satellite/hybride). Lives in the same GlassEffectContainer as the
    /// recenter button so the two share one lensing pass.
    private var mapStyleMenu: some View {
        Menu {
            Picker("Style de carte", selection: $mapStyleChoiceRaw) {
                ForEach(MapStyleChoice.allCases) { choice in
                    Label(choice.label, systemImage: choice.symbol).tag(choice.rawValue)
                }
            }
        } label: {
            Label("Style de carte", systemImage: mapStyleChoice.symbol)
                .labelStyle(.iconOnly)
                .font(.title3.weight(.semibold))
                .frame(width: 46, height: 46)
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
        .accessibilityLabel("Style de carte")
    }

    /// The persistent panel's content, hosted inline by `FloatingSheet` in the
    /// ZStack (no longer a system `.sheet` — §3.11 Option B). Extracted from
    /// `body` so the large initializer doesn't bury the layout structure.
    private var bottomSheetContent: some View {
        BottomSheet(
            searchQuery: $searchQuery,
            isFocused: $searchFocused,
            searchSuggestions: searchCompleter.results,
            onSelectSuggestion: selectSearchSuggestion,
            itineraryStops: $itineraryStops,
            itinerarySpeed: $itinerarySpeed,
            itineraryProfile: $itineraryProfile,
            legEstimates: session.legEstimates,
            onAddStop: { searchFocused = true },
            onLaunchItinerary: launchItinerary,
            favorites: session.engine.status?.favorites ?? [],
            onSelectFavorite: selectFavorite,
            onDeleteFavorite: { fav in session.engine.removeFavorite(lat: fav.lat, lon: fav.lon) },
            hasSavedItinerary: hasSavedItinerary,
            onLoadLastItinerary: loadLastItinerary,
            selectedPlace: selectedPlace,
            placeActions: PlaceActions(
                onTeleport: {
                    guard let place = selectedPlace, requireConnection() else { return }
                    session.engine.setLocation(lat: place.coordinate.latitude, lon: place.coordinate.longitude)
                    selectedPlace = nil
                },
                onRoute: {
                    guard let place = selectedPlace, requireConnection() else { return }
                    session.engine.playRoute(
                        endLat: place.coordinate.latitude,
                        endLon: place.coordinate.longitude,
                        speed: defaultSpeed,
                        profile: defaultProfile
                    )
                    selectedPlace = nil
                },
                onAddStop: {
                    guard let place = selectedPlace else { return }
                    itineraryStops.append(RouteStop(coordinate: place.coordinate, name: place.title))
                    selectedPlace = nil
                },
                onFavorite: { showAddFavorite = true },
                onDismiss: { selectedPlace = nil }
            ),
            patrol: PatrolControls(
                isSettingUp: patrolMode,
                isActive: session.engine.status?.patrolZone?.active == true,
                type: $patrolType,
                radius: $patrolRadius,
                onBegin: {
                    patrolMode = true
                    withAnimation { sheetDetent = .medium }
                },
                onStart: {
                    startPatrol()
                    patrolMode = false
                },
                onCancel: { patrolMode = false },
                onStop: { session.engine.updatePatrolZone(type: patrolType, center: nil, radius: nil, bounds: nil, active: false) }
            ),
            gpx: GpxImport(
                isLoaded: !gpxContent.isEmpty,
                fileName: gpxFileName,
                errorMessage: gpxError,
                speed: $gpxSpeed,
                onPick: {
                    gpxError = nil
                    showGpxImporter = true
                },
                onLaunch: {
                    session.engine.playCustomGpx(gpxContent: gpxContent, speed: gpxSpeed)
                    gpxContent = ""
                    gpxFileName = ""
                },
                onCancel: {
                    gpxContent = ""
                    gpxFileName = ""
                }
            ),
            simulationState: session.engine.status?.state,
            onPauseRoute: { session.engine.pauseRoute() },
            onResumeRoute: { session.engine.resumeRoute() },
            onStopRoute: { session.engine.stopRoute() },
            onOpenSettings: { showSettings = true },
            sheetDetent: sheetDetent,
            collapsedHeight: collapsedSheetHeight,
            onCollapsedHeightChange: { newHeight in
                // FloatingSheet derives the collapsed detent height directly
                // from this value, so we just store it — no detent juggling.
                collapsedSheetHeight = newHeight
            }
        )
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            EngineMapView(
                spoofedLocation: spoofedCoordinate,
                routePreview: routePreview,
                itineraryStops: itineraryStops,
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
                    VStack(spacing: 10) {
                        mapStyleMenu
                        RecenterButton {
                            withAnimation {
                                cameraPosition = .userLocation(fallback: .automatic)
                            }
                        }
                    }
                }
                .padding(.trailing, 16)
                .padding(.bottom, 140)
            }

            // Inline bottom panel — replaces the persistent
            // `.sheet(isPresented: .constant(true))` (§3.11 Option B). A
            // GeometryReader gives it the map's full height so its medium/large
            // detents are screen-relative; bottom-aligned so it hugs the home
            // indicator like Plans' sheet. The map behind stays fully
            // interactive (no dimming, no modal capture).
            GeometryReader { geo in
                FloatingSheet(
                    detent: $sheetDetent,
                    collapsedContentHeight: collapsedSheetHeight,
                    availableHeight: geo.size.height
                ) {
                    bottomSheetContent
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
            }
        }
        .alert("Nom du favori", isPresented: $showAddFavorite) {
            TextField("Nom", text: $newFavoriteName)
            Button("Enregistrer") {
                if let place = selectedPlace, requireConnection() {
                    session.engine.addFavorite(
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
        // GPX picker now attaches to the root — the bottom panel is no longer a
        // sheet, so there's no presenter collision to avoid (§3.11 Option B).
        .fileImporter(isPresented: $showGpxImporter, allowedContentTypes: [.gpx, .xml]) { result in
            switch result {
            case .success(let url):
                loadGpx(from: url)
            case .failure(let error):
                gpxError = error.localizedDescription
            }
        }
        // Settings is now a normal single sheet on the root view. With the
        // bottom panel inlined (no longer a `.sheet`), there's no nested-sheet
        // conflict to work around — the gear simply presents this sheet.
        .sheet(isPresented: $showSettings) {
            SettingsSheet(
                engineAddress: $engineAddress,
                engine: session.engine,
                discovery: discovery,
                onToggleConnection: toggleConnection,
                onRetryDiscovery: startDiscovery,
                onApplyPort: reconnect,
                liveActivityEnabled: $liveActivityEnabled,
                keepAliveEnabled: $keepAliveEnabled,
                keepAliveInterval: $keepAliveInterval,
                notificationsEnabled: $notificationsEnabled,
                locationAuthorization: session.location.authorizationStatus
            )
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
        .onChange(of: session.engine.state) { _ in
            session.handleEngineStateChange(notificationsEnabled: notificationsEnabled)
        }
        .onChange(of: session.engine.status?.state) { _ in
            session.handleSimulationStateChange(notificationsEnabled: notificationsEnabled)
        }
        .onChange(of: discovery.state) { newState in
            guard case .found(let host, let port) = newState else { return }
            engineAddress = "\(host):\(port)"
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
            // — expand the sheet so it's actually visible when set.
            if place != nil {
                withAnimation { sheetDetent = .medium }
            }
        }
        .onChange(of: selectedFeature) { _, feature in
            // Tapping a system POI resolves into the same SelectedPlace flow as
            // a long-press, so the user gets the identical action card
            // (Téléporter / Itinéraire / Étape / Favori). Cleared immediately so
            // re-tapping the same POI works, and so the map's own selection
            // highlight doesn't linger once the card owns the interaction.
            guard let feature else { return }
            let coordsText = String(format: "%.5f, %.5f", feature.coordinate.latitude, feature.coordinate.longitude)
            selectedPlace = SelectedPlace(
                coordinate: feature.coordinate,
                title: feature.title ?? "Lieu",
                subtitle: coordsText
            )
            selectedFeature = nil
        }
    }

}

#Preview {
    ContentView()
}
