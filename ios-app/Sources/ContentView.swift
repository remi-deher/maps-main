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
    // Espace de noms des effets de verre de la couche flottante : permet aux
    // trois contrôles de carte de fusionner en un seul bloc, et au bouton
    // « Rechercher dans cette zone » de morpher à l'apparition.
    @Namespace var mapGlassNamespace
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
    // Tant que l'utilisateur n'a pas lu la carte d'explication, aucune alerte
    // système n'est déclenchée : sinon localisation, notifications et réseau
    // local s'empilent au premier lancement, sans contexte. Voir
    // docs/UI_UX_AUDIT_IOS_2026-09.md, P2-5.
    @AppStorage("hasSeenPermissionsPrimer") var hasSeenPermissionsPrimer = false

    // The system POI the user tapped on the map, if any. Resolved into a
    // `coordinator.selectedPlace` (and cleared) by an onChange below.

    // Patrol-zone setup, promoted out of Reglages: `coordinator.patrolMode` shows the
    // setup panel in the sheet and draws a live dashed preview on the map;
    // type/radius are the zone being defined (moved here from SettingsSheet).

    // GPX import, promoted out of Reglages > Outils into the sheet: pick a
    // track, then a GpxPanel shows the file + a speed slider before launching.

    @AppStorage("mapStyleChoice") var mapStyleChoiceRaw: String = MapStyleChoice.standard.rawValue
    @AppStorage("mapShowsTraffic") var mapShowsTraffic = true

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

    // Le corps est découpé en trois groupes d'observateurs plutôt qu'en une
    // seule chaîne de vingt modificateurs : au-delà, le vérificateur de types
    // de Swift abandonne (« unable to type-check this expression in reasonable
    // time »). Chaque fonction est inférée séparément, ce qui ramène le coût à
    // quelque chose de raisonnable — et rend la lecture plus simple.
    var body: some View {
        observingEngineState(
            observingSheetAndSearch(
                observingLifecycle(mapStackWithSheet)
            )
        )
    }

    // La carte plein écran et ses contrôles flottants.
    private var mapStack: some View {
        ZStack(alignment: .bottom) {
            EngineMapView(
                spoofedLocation: coordinator.spoofedCoordinate(session: session),
                selectedPlace: coordinator.selectedPlace,
                searchResults: coordinator.searchResults,
                onSelectSearchResult: { coordinator.selectSearchResult($0) },
                routePreview: coordinator.routePreview(session: session),
                alternativeRoutes: coordinator.unselectedAlternativePaths,
                itineraryStops: coordinator.displayedItineraryStops,
                patrolZone: coordinator.patrolZone(session: session),
                patrolPreview: coordinator.patrolPreview(session: session),
                mapStyleChoice: mapStyleChoice,
                showsTraffic: mapShowsTraffic,
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
                onTap: handleMapTap,
                onRegionChange: { coordinator.visibleRegion = $0 },
                sheetCoverage: coordinator.sheetCoverage
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
    }

    // ... surmontée de la sheet persistante.
    private var mapStackWithSheet: some View {
        mapStack
        .sheet(isPresented: $coordinator.nativeSheetPresented) {
            bottomSheetContent()
                .presentationDetents(bottomSheetPresentationDetents, selection: $coordinator.nativeSheetDetent)
                .presentationDragIndicator(.visible)
                // Comme Plans : la carte reste manipulable derrière la sheet
                // jusqu'au détent moyen. Au détent plein, elle est de toute
                // façon couverte, et laisser passer les gestes y provoque des
                // manipulations involontaires.
                .presentationBackgroundInteraction(.enabled(upThrough: mediumPresentationDetent))
                .presentationCornerRadius(26)
                .interactiveDismissDisabled(true)
        }
    }

    // Cycle de vie, préférences persistées, clavier et liens entrants.
    private func observingLifecycle(_ content: some View) -> some View {
        content
        .onAppear {
            session.location.setAccuracyMode(locationAccuracyMode)
            // Seed the itinerary builder with the user's default speed/profile.
            coordinator.itinerarySpeed = defaultSpeed
            coordinator.itineraryProfile = defaultProfile
            // Mirror the persisted keep-alive cadence into the engine so the
            // background location callback can throttle RELANCE without reading
            // SwiftUI state (unavailable while suspended).
            coordinator.updateKeepAlive(session: session, enabled: keepAliveEnabled, interval: keepAliveInterval)
            coordinator.loadRecentPlaces()
            EngineDiscovery.shared = discovery

            if hasSeenPermissionsPrimer {
                requestPermissionsAndDiscover()
            } else {
                // Déplie la sheet pour que la carte d'explication soit lue
                // avant que la moindre alerte système n'apparaisse.
                coordinator.sheetDetent = .medium
            }
        }
        .onChange(of: searchFocused) { _, isFocused in
            guard isFocused else { return }
            // Plans ouvre son panneau en grand dès qu'on touche le champ.
            // Le décalage d'une poignée de millisecondes laisse le clavier
            // amorcer sa montée : lancer les deux animations sur la même frame
            // redimensionne et repositionne la même hiérarchie de vues, ce qui
            // rendait l'apparition du clavier visiblement lente.
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(80))
                guard searchFocused else { return }
                withAnimation(.easeOut(duration: 0.25)) {
                    coordinator.sheetDetent = .large
                }
            }
        }
        .onOpenURL { url in
            // Tap sur la Live Activity / l'île dynamique : ouvrir le détail de
            // ce qui tourne, plutôt que de se contenter de lancer l'app.
            guard url.scheme == "gpsmock" else { return }
            withAnimation { coordinator.sheetDetent = .large }
        }
        .onChange(of: locationAccuracyMode) { _, mode in
            session.location.setAccuracyMode(mode)
        }
        .onChange(of: keepAliveEnabled) { _, enabled in
            session.applyKeepAliveEnabled(enabled, interval: keepAliveInterval)
        }
        .onChange(of: keepAliveInterval) { _, interval in
            coordinator.updateKeepAlive(session: session, enabled: keepAliveEnabled, interval: interval)
        }
        .onChange(of: notificationsEnabled) { _, enabled in
            if enabled { NotificationManager.shared.requestPermission() }
        }
        .onChange(of: coordinator.showSettings) { _, isPresented in
            // Reset the diagnostics deep-link once the settings sheet closes, so
            // the next plain "Réglages" tap opens the top-level menu.
            if !isPresented { coordinator.settingsOpenToDiagnostics = false }
        }
    }

    // Détents de la sheet, recherche et itinéraire en cours de composition.
    private func observingSheetAndSearch(_ content: some View) -> some View {
        content
        .onChange(of: coordinator.nativeSheetPresented) { _, isPresented in
            if !isPresented {
                coordinator.nativeSheetPresented = true
            }
        }
        .onChange(of: coordinator.nativeSheetDetent) { _, newDetent in
            syncSheetDetent(to: newDetent)
        }
        .onChange(of: coordinator.sheetDetent) { _, newDetent in
            syncNativeSheetDetent(to: newDetent)
        }
        .onChange(of: discovery.state) { _, newState in handleDiscoveryStateChange(newState) }
        .onChange(of: coordinator.searchQuery) { _, newValue in
            // Les suggestions suivent la carte, pas le téléphone : c'est ce que
            // l'utilisateur regarde qui définit « près d'ici ».
            if let region = coordinator.visibleRegion {
                coordinator.searchCompleter.updateRegion(region)
            } else if let coordinate = session.location.lastLocation?.coordinate {
                coordinator.searchCompleter.updateRegion(center: coordinate)
            }
            coordinator.searchCompleter.queryFragment = newValue
            // La requête diverge de celle qui a produit les résultats affichés :
            // l'utilisateur est en train d'en formuler une autre, on rend la
            // main aux suggestions.
            if newValue != coordinator.lastSearchQuery,
               !coordinator.searchResults.isEmpty || coordinator.selectedPlace != nil {
                coordinator.clearSelection()
            }
            // Le redimensionnement de la sheet est piloté par le focus
            // (onChange ci-dessous), pas par la frappe : sinon le panneau
            // sautait une seconde fois au premier caractère.
        }
        .onChange(of: coordinator.itineraryStops) { _, newStops in handleItineraryStopsChange(newStops) }
        .onChange(of: coordinator.itineraryProfile) { _, newProfile in handleItineraryProfileChange(newProfile) }
        .onChange(of: coordinator.selectedPlace) { _, place in
            // The place card now lives inside the bottom sheet (it used to
            // float over the map, where the sheet could end up covering it)
            // - expand the sheet so it's actually visible when set.
            if place != nil {
                withAnimation { coordinator.sheetDetent = .medium }
            }
        }
    }

    // État du moteur, Live Activity et sélection d'un POI système.
    private func observingEngineState(_ content: some View) -> some View {
        content
        .onChange(of: coordinator.engineState(session: session)) { _, _ in
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
        .onChange(of: liveActivityKey) { _, key in
            liveActivity.sync(state: key.state, locationName: key.name, enabled: liveActivityEnabled)
        }
        .onChange(of: liveActivityEnabled) { _, enabled in
            liveActivity.sync(
                state: coordinator.engineStatusState(session: session),
                locationName: coordinator.lastInjectedLocationName(session: session),
                enabled: enabled
            )
        }
        .onChange(of: coordinator.selectedFeature) { _, feature in
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
                        subtitle: mapItem.placemark.title,
                        category: mapItem.pointOfInterestCategory
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
        }
    }

    // Les trois autorisations demandées d'un bloc, mais seulement après que
    // l'utilisateur a lu à quoi elles servent (FirstRunPrimerCard). iOS met les
    // alertes en file : elles s'enchaînent au lieu de surgir sans contexte.
    func requestPermissionsAndDiscover() {
        session.location.requestPermission()
        if notificationsEnabled { NotificationManager.shared.requestPermission() }
        discovery.start()
    }

    func completeFirstRunPrimer() {
        hasSeenPermissionsPrimer = true
        requestPermissionsAndDiscover()
    }

    // Tap sur la carte : Plans ferme la fiche et replie la sheet. Un tap sur un
    // POI arme `selectedFeature`, que l'`onChange` du corps transforme en
    // `selectedPlace` — on laisse donc cette propagation se faire, et on
    // n'annule que si la sélection n'a pas bougé entre-temps. Sans ce garde, un
    // tap sur un point d'intérêt ouvrirait puis refermerait sa fiche aussitôt.
    func handleMapTap() {
        searchFocused = false
        let selectionBeforeTap = coordinator.selectedPlace
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(120))
            guard coordinator.selectedFeature == nil,
                  coordinator.selectedPlace == selectionBeforeTap else { return }
            if coordinator.selectedPlace != nil {
                coordinator.clearSelection()
            } else if coordinator.sheetDetent != .collapsed {
                collapseBottomSheet()
            }
        }
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
        coordinator.refreshRouteAlternatives(session: session)
        coordinator.estimator.recomputeLegEstimates(
            stops: newStops,
            profile: coordinator.itineraryProfile,
            currentLocation: session.location.lastLocation,
            onComplete: { plan in
                coordinator.legEstimates = plan.estimates
                // Ne pas écraser le tracé de la variante retenue, qui fait
                // autorité dès qu'il y a des alternatives.
                if coordinator.routeAlternatives.isEmpty {
                    coordinator.plannedRoutePath = plan.path
                }
            }
        )
    }

    private func handleItineraryProfileChange(_ newProfile: String) {
        coordinator.refreshRouteAlternatives(session: session)
        coordinator.estimator.recomputeLegEstimates(
            stops: coordinator.itineraryStops,
            profile: newProfile,
            currentLocation: session.location.lastLocation,
            onComplete: { plan in
                coordinator.legEstimates = plan.estimates
                if coordinator.routeAlternatives.isEmpty {
                    coordinator.plannedRoutePath = plan.path
                }
            }
        )
    }

}

#Preview {
    ContentView()
}
