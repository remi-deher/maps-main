import SwiftUI
import UIKit
import UniformTypeIdentifiers

extension ContentView {
    // The persistent panel's content, hosted by the system sheet. Kept out of
    // ContentView.swift so the root view reads as the app shell instead of a
    // long dependency-wiring block.
    func bottomSheetContent() -> some View {
        BottomSheet(
            search: searchContext,
            itinerary: itineraryContext,
            library: libraryContext,
            place: placeContext,
            patrol: patrolControls,
            gpx: gpxImport,
            simulation: simulationContext,
            chrome: chromeContext,
            status: statusContext,
            presentation: BottomSheetPresentationContext(
                sheetDetent: $coordinator.sheetDetent
            )
        )
        // Retour haptique d'échec quand une action est refusée faute de
        // moteur : le bandeau explique, l'haptique signale (audit P0-4).
        .sensoryFeedback(.error, trigger: coordinator.actionBlockedFeedback)
        // La barre « Terminé » doit être déclarée sur la présentation qui
        // contient le champ — ici la sheet. Posée sur ContentView (le
        // présentateur), elle ne s'attachait jamais au clavier du champ de
        // recherche. Voir docs/UI_UX_AUDIT_IOS_2026-09.md, P2-4.
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Terminé") { searchFocused = false }
            }
        }
        .fileImporter(isPresented: $coordinator.showGpxImporter, allowedContentTypes: [.gpx, .xml]) { result in
            switch result {
            case .success(let url):
                coordinator.loadGpx(from: url)
            case .failure(let error):
                coordinator.gpxError = error.localizedDescription
            }
        }
        .sheet(isPresented: $coordinator.showSettings) {
            SettingsSheet(
                openToDiagnostics: coordinator.settingsOpenToDiagnostics,
                engineAddress: $engineAddress,
                engine: session.engine,
                discovery: discovery,
                onToggleConnection: { session.toggleConnection(engineAddress: engineAddress, keepAliveEnabled: keepAliveEnabled) },
                onRetryDiscovery: { discovery.start() },
                onApplyPort: { session.reconnect(engineAddress: engineAddress) },
                liveActivityEnabled: $liveActivityEnabled,
                keepAliveEnabled: $keepAliveEnabled,
                keepAliveInterval: $keepAliveInterval,
                notificationsEnabled: $notificationsEnabled,
                locationAuthorization: session.location.authorizationStatus
            )
            // Settings stay on a sheet over the map (never a full-screen cover
            // that hides it) — Plans never leaves the map. Large detent only,
            // since the settings list needs the height.
            .presentationDetents([.large])
        }
    }

    var collapsedPresentationDetentHeight: CGFloat {
        BottomSheet.collapsedDetentHeight
    }

    var mediumPresentationDetent: PresentationDetent {
        .fraction(0.43)
    }

    var collapsedPresentationDetent: PresentationDetent {
        .height(collapsedPresentationDetentHeight)
    }

    var bottomSheetPresentationDetents: Set<PresentationDetent> {
        [collapsedPresentationDetent, mediumPresentationDetent, .large]
    }

    func presentationDetent(for detent: SheetDetent) -> PresentationDetent {
        switch detent {
        case .collapsed:
            return collapsedPresentationDetent
        case .medium:
            return mediumPresentationDetent
        case .large:
            return .large
        }
    }

    func sheetDetent(for presentationDetent: PresentationDetent) -> SheetDetent {
        if presentationDetent == .large {
            return .large
        }
        if presentationDetent == mediumPresentationDetent {
            return .medium
        }
        return .collapsed
    }

    func syncNativeSheetDetent(to detent: SheetDetent) {
        let target = presentationDetent(for: detent)
        if coordinator.nativeSheetDetent != target {
            coordinator.nativeSheetDetent = target
        }
    }

    func syncSheetDetent(to presentationDetent: PresentationDetent) {
        let target = sheetDetent(for: presentationDetent)
        if coordinator.sheetDetent != target {
            coordinator.sheetDetent = target
        }
    }

    func collapseBottomSheet() {
        withAnimation(.interactiveSpring(response: 0.28, dampingFraction: 0.88)) {
            coordinator.sheetDetent = .collapsed
            coordinator.nativeSheetDetent = collapsedPresentationDetent
        }
    }

    var searchContext: BottomSheetSearchContext {
        BottomSheetSearchContext(
            query: $coordinator.searchQuery,
            isFocused: $searchFocused,
            suggestions: coordinator.searchCompleter.results,
            isSearching: coordinator.searchCompleter.isSearching,
            onSelectSuggestion: { completion in
                // Rend la main au clavier avant de recentrer la carte : sinon
                // il reste ouvert par-dessus le résultat qu'on vient de choisir.
                searchFocused = false
                coordinator.selectSearchSuggestion(completion)
            },
            onSubmit: {
                searchFocused = false
                coordinator.submitSearch(session: session)
            },
            onSelectCategory: { category in
                searchFocused = false
                coordinator.searchQuery = category
                coordinator.runTextSearch(
                    query: category,
                    fallbackRegionCenter: session.location.lastLocation?.coordinate
                )
            }
        )
    }

    var itineraryContext: BottomSheetItineraryContext {
        BottomSheetItineraryContext(
            stops: $coordinator.itineraryStops,
            speed: $coordinator.itinerarySpeed,
            profile: $coordinator.itineraryProfile,
            legEstimates: coordinator.legEstimates,
            activeRoute: coordinator.activeRoute,
            alternatives: coordinator.routeAlternativeChoices,
            selectedAlternativeIndex: coordinator.selectedAlternativeIndex,
            onSelectAlternative: { coordinator.selectAlternative($0) },
            onAddStop: { searchFocused = true },
            onLaunch: { coordinator.launchItinerary(session: session) },
            onShowActiveRouteDetails: coordinator.showActiveRouteDetails,
            onRecenterActiveRoute: { coordinator.recenterActiveRoute(session: session) }
        )
    }

    var libraryContext: BottomSheetLibraryContext {
        BottomSheetLibraryContext(
            favorites: session.engine.status?.favorites ?? [],
            onSelectFavorite: { fav in coordinator.selectFavorite(fav, session: session) },
            onDeleteFavorite: { favorite in
                session.engine.removeFavorite(lat: favorite.lat, lon: favorite.lon)
            },
            recentPlaces: coordinator.recentPlaces,
            onSelectRecentPlace: coordinator.selectRecentPlace,
            onDeleteRecentPlace: { coordinator.removeRecentPlace($0) },
            onClearRecentPlaces: coordinator.clearRecentPlaces,
            hasSavedItinerary: coordinator.hasSavedItinerary,
            onLoadLastItinerary: coordinator.loadLastItinerary
        )
    }

    var placeContext: BottomSheetPlaceContext {
        BottomSheetPlaceContext(
            selectedPlace: coordinator.selectedPlace,
            resultPosition: coordinator.selectedResultPosition,
            resultCount: coordinator.searchResults.count,
            onSelectPreviousResult: { coordinator.stepSearchResult(by: -1) },
            onSelectNextResult: { coordinator.stepSearchResult(by: 1) },
            results: coordinator.searchResults,
            onSelectResult: { coordinator.selectSearchResult($0) },
            referenceCoordinate: coordinator.spoofedCoordinate(session: session) ?? session.location.lastLocation?.coordinate,
            actions: placeActions
        )
    }

    var simulationContext: BottomSheetSimulationContext {
        BottomSheetSimulationContext(
            state: session.engine.status?.state,
            onPauseRoute: { coordinator.pauseActiveRoute(session: session) },
            onResumeRoute: { coordinator.resumeActiveRoute(session: session) },
            onStopRoute: { coordinator.stopActiveRoute(session: session) }
        )
    }

    // État du moteur remonté sur l'écran principal : bandeau de connexion
    // quand il manque, affichage permanent de la position injectée sinon.
    // Voir docs/UI_UX_AUDIT_IOS_2026-09.md, P0-4 et P2-7.
    var statusContext: BottomSheetStatusContext {
        let simulationState = session.engine.status?.state
        let hasSimulationBanner = coordinator.activeRoute != nil
            || session.engine.status?.patrolZone?.active == true
            || simulationState == "moving"
            || simulationState == "paused"

        return BottomSheetStatusContext(
            connectionState: coordinator.engineState(session: session),
            lastError: session.engine.lastError,
            injectedLocation: session.engine.status?.lastInjectedLocation,
            driftMeters: session.engine.status?.lastRealLocation?.drift,
            hasDedicatedSimulationBanner: hasSimulationBanner,
            onConnect: {
                session.toggleConnection(engineAddress: engineAddress, keepAliveEnabled: keepAliveEnabled)
            },
            onOpenSettings: { coordinator.showSettings = true }
        )
    }

    var chromeContext: BottomSheetChromeContext {
        BottomSheetChromeContext(
            showsFirstRunPrimer: !hasSeenPermissionsPrimer,
            onCompleteFirstRunPrimer: completeFirstRunPrimer,
            onOpenSettings: { coordinator.showSettings = true },
            onReportProblem: {
                coordinator.settingsOpenToDiagnostics = true
                coordinator.showSettings = true
            },
            onCollapseSheet: collapseBottomSheet
        )
    }

    var placeActions: PlaceActions {
        PlaceActions(
            onTeleport: teleportSelectedPlace,
            onRoute: routeToSelectedPlace,
            onAddStop: addSelectedPlaceAsStop,
            onFavorite: favoriteSelectedPlace,
            onRemoveFavorite: unfavoriteSelectedPlace,
            onCopyCoordinates: copySelectedPlaceCoordinates,
            onDismiss: { coordinator.dismissSelectedPlace() }
        )
    }

    var patrolControls: PatrolControls {
        PatrolControls(
            isSettingUp: coordinator.patrolMode,
            isActive: session.engine.status?.patrolZone?.active == true,
            type: $coordinator.patrolType,
            radius: $coordinator.patrolRadius,
            onBegin: beginPatrolSetup,
            onStart: commitPatrolSetup,
            onCancel: { coordinator.patrolMode = false },
            onStop: stopPatrol
        )
    }

    var gpxImport: GpxImport {
        GpxImport(
            isLoaded: !coordinator.gpxContent.isEmpty,
            fileName: coordinator.gpxFileName,
            errorMessage: coordinator.gpxError,
            speed: $coordinator.gpxSpeed,
            onPick: pickGpxFile,
            onLaunch: launchGpxTrack,
            onCancel: clearGpxTrack
        )
    }

    func teleportSelectedPlace() {
        guard let place = coordinator.selectedPlace, coordinator.requireConnection(session: session) else { return }
        session.engine.setLocation(lat: place.coordinate.latitude, lon: place.coordinate.longitude, name: place.title)
        coordinator.clearSelection()
    }

    func routeToSelectedPlace() {
        guard let place = coordinator.selectedPlace else { return }
        coordinator.startRoute(to: place, session: session, defaultSpeed: defaultSpeed, defaultProfile: defaultProfile)
    }

    func addSelectedPlaceAsStop() {
        guard let place = coordinator.selectedPlace else { return }
        if coordinator.activeRoute != nil {
            coordinator.addSelectedPlaceToActiveRoute(session: session)
            return
        }
        coordinator.itineraryStops.append(RouteStop(coordinate: place.coordinate, name: place.title))
        coordinator.clearSelection()
    }

    func favoriteSelectedPlace() {
        guard let place = coordinator.selectedPlace, coordinator.requireConnection(session: session) else { return }
        session.engine.addFavorite(
            lat: place.coordinate.latitude,
            lon: place.coordinate.longitude,
            name: place.title
        )
    }

    func unfavoriteSelectedPlace() {
        guard let place = coordinator.selectedPlace, coordinator.requireConnection(session: session) else { return }
        session.engine.removeFavorite(lat: place.coordinate.latitude, lon: place.coordinate.longitude)
    }

    func copySelectedPlaceCoordinates() {
        guard let place = coordinator.selectedPlace else { return }
        UIPasteboard.general.string = String(
            format: "%.6f, %.6f",
            place.coordinate.latitude,
            place.coordinate.longitude
        )
    }

    func beginPatrolSetup() {
        coordinator.patrolMode = true
        withAnimation { coordinator.sheetDetent = .medium }
    }

    func commitPatrolSetup() {
        coordinator.startPatrol(session: session)
        coordinator.patrolMode = false
    }

    func stopPatrol() {
        session.engine.updatePatrolZone(
            type: coordinator.patrolType,
            center: nil,
            radius: nil,
            bounds: nil,
            active: false
        )
    }

    func pickGpxFile() {
        coordinator.gpxError = nil
        coordinator.showGpxImporter = true
    }

    func launchGpxTrack() {
        session.engine.playCustomGpx(gpxContent: coordinator.gpxContent, speed: coordinator.gpxSpeed)
        clearGpxTrack()
    }

    func clearGpxTrack() {
        coordinator.gpxContent = ""
        coordinator.gpxFileName = ""
    }
}
