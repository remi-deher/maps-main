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
    @State var coordinator = MapCoordinator()
    @FocusState var searchFocused: Bool
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

    // The system POI the user tapped on the map, if any. Resolved into a
    // `coordinator.selectedPlace` (and cleared) by an onChange below.

    // Patrol-zone setup, promoted out of Reglages: `coordinator.patrolMode` shows the
    // setup panel in the sheet and draws a live dashed preview on the map;
    // type/radius are the zone being defined (moved here from SettingsSheet).

    // GPX import, promoted out of Reglages > Outils into the sheet: pick a
    // track, then a GpxPanel shows the file + a speed slider before launching.

    @AppStorage("mapStyleChoice") var mapStyleChoiceRaw: String = MapStyleChoice.standard.rawValue

    // State variables moved to MapCoordinator
    private struct LiveActivityKey: Equatable {
        let state: String?
        let name: String?
    }

    private var liveActivityKey: LiveActivityKey {
        LiveActivityKey(
            state: coordinator.engineStatusState(session: session),
            name: coordinator.lastInjectedLocationName(session: session)
        )
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            EngineMapView(
                spoofedLocation: coordinator.spoofedCoordinate(session: session),
                selectedPlace: coordinator.selectedPlace,
                searchResults: coordinator.searchResults,
                onSelectSearchResult: { coordinator.selectSearchResult($0) },
                routePreview: coordinator.routePreview(session: session),
                itineraryStops: coordinator.displayedItineraryStops,
                patrolZone: coordinator.patrolZone(session: session),
                patrolPreview: coordinator.patrolPreview(session: session),
                mapStyleChoice: mapStyleChoice,
                selectedFeature: $coordinator.selectedFeature,
                cameraPosition: $coordinator.cameraPosition,
                onLongPress: { coordinate in
                    searchFocused = false
                    MapLongPressTip().invalidate(reason: .actionPerformed)
                    Task {
                        let place = await coordinator.reverseGeocode(coordinate)
                        await MainActor.run {
                            coordinator.rememberRecentPlace(place)
                            coordinator.selectedPlace = place
                        }
                    }
                },
                onRegionChange: { coordinator.visibleRegion = $0 }
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
        .sheet(isPresented: $coordinator.nativeSheetPresented) {
            bottomSheetContent(scrollOffset: $coordinator.sheetScrollOffset)
                .presentationDetents(bottomSheetPresentationDetents, selection: $coordinator.nativeSheetDetent)
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
            coordinator.itinerarySpeed = defaultSpeed
            coordinator.itineraryProfile = defaultProfile
            // Mirror the persisted keep-alive cadence into the engine so the
            // background location callback can throttle RELANCE without reading
            // SwiftUI state (unavailable while suspended).
            coordinator.updateKeepAlive(session: session, enabled: keepAliveEnabled, interval: keepAliveInterval)
            // updated above
            coordinator.loadRecentPlaces()
            discovery.start()
        }
        .onChange(of: locationAccuracyMode) { mode in
            session.location.setAccuracyMode(mode)
        }
        .onChange(of: keepAliveEnabled) { enabled in
            session.applyKeepAliveEnabled(enabled, interval: keepAliveInterval)
        }
        .onChange(of: keepAliveInterval) { interval in
            coordinator.updateKeepAlive(session: session, enabled: keepAliveEnabled, interval: interval)
        }
        .onChange(of: notificationsEnabled) { enabled in
            if enabled { NotificationManager.shared.requestPermission() }
        }
        .onChange(of: coordinator.showSettings) { isPresented in
            // Reset the diagnostics deep-link once the settings sheet closes, so
            // the next plain "Réglages" tap opens the top-level menu.
            if !isPresented { coordinator.settingsOpenToDiagnostics = false }
        }
        .onChange(of: coordinator.nativeSheetPresented) { isPresented in
            if !isPresented {
                coordinator.nativeSheetPresented = true
            }
        }
        .onChange(of: coordinator.nativeSheetDetent) { newDetent in
            syncSheetDetent(to: newDetent)
        }
        .onChange(of: coordinator.sheetDetent) { newDetent in
            syncNativeSheetDetent(to: newDetent)
        }
        .onChange(of: coordinator.engineState(session: session)) { _ in
            session.handleEngineStateChange(notificationsEnabled: notificationsEnabled)
        }
        .onChange(of: coordinator.engineStatusState(session: session)) { oldState, newState in
            session.handleSimulationStateChange(notificationsEnabled: notificationsEnabled)
            coordinator.syncActiveRouteState(
                oldEngineState: oldState,
                newEngineState: newState,
                oldNavigationState: coordinator.navigationState(session: session),
                newNavigationState: coordinator.navigationState(session: session)
            )
        }
        .onChange(of: coordinator.navigationState(session: session)) { oldState, newState in
            coordinator.syncActiveRouteState(
                oldEngineState: coordinator.engineStatusState(session: session),
                newEngineState: coordinator.engineStatusState(session: session),
                oldNavigationState: oldState,
                newNavigationState: newState
            )
        }
        .onChange(of: discovery.state, perform: handleDiscoveryStateChange)
        .onChange(of: coordinator.searchQuery) { newValue in
            if let coordinate = session.location.lastLocation?.coordinate {
                coordinator.searchCompleter.updateRegion(center: coordinate)
            }
            coordinator.searchCompleter.queryFragment = newValue
            // Plans expands its sheet the moment you start typing, so results
            // aren't hidden under a collapsed handle. Triggered by the query
            // itself rather than `searchFocused`: expanding the sheet the
            // instant the field is tapped raced the keyboard's own slide-up
            // animation (both resize/reposition the same view hierarchy at
            // once), which made the keyboard visibly slow to appear.
            if !newValue.isEmpty {
                withAnimation { coordinator.sheetDetent = .medium }
            }
        }
        .onChange(of: coordinator.itineraryStops, perform: handleItineraryStopsChange)
        .onChange(of: coordinator.itineraryProfile, perform: handleItineraryProfileChange)
        .onChange(of: liveActivityKey) { key in
            liveActivity.sync(state: key.state, locationName: key.name, enabled: liveActivityEnabled)
        }
        .onChange(of: liveActivityEnabled) { enabled in
            liveActivity.sync(
                state: coordinator.engineStatusState(session: session),
                locationName: coordinator.lastInjectedLocationName(session: session),
                enabled: enabled
            )
        }
        .onChange(of: coordinator.selectedPlace) { place in
            // The place card now lives inside the bottom sheet (it used to
            // float over the map, where the sheet could end up covering it)
            // - expand the sheet so it's actually visible when set.
            if place != nil {
                withAnimation { coordinator.sheetDetent = .medium }
            }
        }
        .onChange(of: coordinator.selectedFeature, perform: { feature in
            // Tapping a system POI resolves into the same SelectedPlace flow as
            // a long-press, so the user gets the identical action card
            // (Teleporter / Itineraire / Etape / Favori). Cleared immediately so
            // re-tapping the same POI works, and so the map's own selection
            // highlight doesn't linger once the card owns the interaction.
            guard let feature else { return }
            // Show a provisional card instantly (title from the feature), then
            // resolve the feature into a real MKMapItem to replace the raw
            // coordinate subtitle with a proper address — Plans' tap-a-POI card.
            let provisional = SelectedPlace(
                coordinate: feature.coordinate,
                title: feature.title ?? "Lieu",
                subtitle: nil
            )
            coordinator.selectedPlace = provisional
            coordinator.selectedFeature = nil
            Task {
                let mapItem: MKMapItem? = await withCheckedContinuation { continuation in
                    MKMapItemRequest(feature: feature).getMapItem { item, _ in
                        continuation.resume(returning: item)
                    }
                }
                let resolved: SelectedPlace
                if let mapItem {
                    resolved = SelectedPlace(
                        coordinate: mapItem.placemark.coordinate,
                        title: mapItem.name ?? provisional.title,
                        subtitle: mapItem.placemark.title
                    )
                } else {
                    resolved = provisional
                }
                coordinator.rememberRecentPlace(resolved)
                // Only apply if the user hasn't moved on to another selection.
                if coordinator.selectedPlace == provisional {
                    coordinator.selectedPlace = resolved
                }
            }
        })
    }

    private func handleDiscoveryStateChange(_ newState: EngineDiscovery.State) {
        guard case .found(let host, let port) = newState else { return }
        // Only auto-fill when the user hasn't configured an address. A
        // manually entered (working, IPv4) address must not be clobbered by
        // a discovery result - the user explicitly chose it.
        if engineAddress.isEmpty {
            engineAddress = "\(host):\(port)"
        }
        let state = coordinator.engineState(session: session)
        if state != .connected && state != .connecting {
            session.toggleConnection(engineAddress: engineAddress, keepAliveEnabled: keepAliveEnabled)
        }
    }

    private func handleItineraryStopsChange(_ newStops: [RouteStop]) {
        // Plans-style: adding (or removing/reordering) a stop reframes
        // the camera to show the whole itinerary, not just the new point.
        coordinator.fitItinerary(newStops, session: session)
        if newStops.isEmpty {
            coordinator.plannedRoutePath = []
        }
        coordinator.estimator.recomputeLegEstimates(
            stops: newStops,
            profile: coordinator.itineraryProfile,
            currentLocation: session.location.lastLocation,
            onComplete: { plan in
                coordinator.legEstimates = plan.estimates
                coordinator.plannedRoutePath = plan.path
            }
        )
        if !newStops.isEmpty {
            withAnimation { coordinator.sheetDetent = .medium }
        }
    }

    private func handleItineraryProfileChange(_ newProfile: String) {
        coordinator.estimator.recomputeLegEstimates(
            stops: coordinator.itineraryStops,
            profile: newProfile,
            currentLocation: session.location.lastLocation,
            onComplete: { plan in
                coordinator.legEstimates = plan.estimates
                coordinator.plannedRoutePath = plan.path
            }
        )
    }

}

#Preview {
    ContentView()
}
