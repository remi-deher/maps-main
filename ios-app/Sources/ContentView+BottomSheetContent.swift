import SwiftUI
import UIKit
import UniformTypeIdentifiers

extension ContentView {
    // The persistent panel's content, hosted by the system sheet. Kept out of
    // ContentView.swift so the root view reads as the app shell instead of a
    // long dependency-wiring block.
    func bottomSheetContent(scrollOffset: Binding<CGFloat>) -> some View {
        BottomSheet(
            search: BottomSheetSearchContext(
                query: $coordinator.searchQuery,
                isFocused: $searchFocused,
                suggestions: coordinator.searchCompleter.results,
                onSelectSuggestion: coordinator.selectSearchSuggestion
            ),
            itinerary: BottomSheetItineraryContext(
                stops: $coordinator.itineraryStops,
                speed: $coordinator.itinerarySpeed,
                profile: $coordinator.itineraryProfile,
                legEstimates: coordinator.estimator.legEstimates,
                activeRoute: coordinator.activeRoute,
                onAddStop: { searchFocused = true },
                onLaunch: { coordinator.launchItinerary(session: session) },
                onShowActiveRouteDetails: coordinator.showActiveRouteDetails,
                onRecenterActiveRoute: { coordinator.recenterActiveRoute(session: session) }
            ),
            library: BottomSheetLibraryContext(
                favorites: session.engine.status?.favorites ?? [],
                onSelectFavorite: { fav in coordinator.selectFavorite(fav, session: session) },
                onDeleteFavorite: { favorite in
                    session.engine.removeFavorite(lat: favorite.lat, lon: favorite.lon)
                },
                recentPlaces: coordinator.recentPlaces,
                onSelectRecentPlace: coordinator.selectRecentPlace,
                onClearRecentPlaces: coordinator.clearRecentPlaces,
                hasSavedItinerary: coordinator.hasSavedItinerary,
                onLoadLastItinerary: coordinator.loadLastItinerary
            ),
            place: BottomSheetPlaceContext(
                selectedPlace: coordinator.selectedPlace,
                actions: placeActions
            ),
            patrol: patrolControls,
            gpx: gpxImport,
            simulation: BottomSheetSimulationContext(
                state: session.engine.status?.state,
                onPauseRoute: { coordinator.pauseActiveRoute(session: session) },
                onResumeRoute: { coordinator.resumeActiveRoute(session: session) },
                onStopRoute: { coordinator.stopActiveRoute(session: session) }
            ),
            chrome: BottomSheetChromeContext(
                onOpenSettings: { coordinator.showSettings = true },
                onCollapseSheet: collapseBottomSheet
            ),
            presentation: BottomSheetPresentationContext(
                scrollOffset: scrollOffset,
                sheetDetent: $coordinator.sheetDetent,
                collapsedHeight: coordinator.collapsedSheetHeight,
                onCollapsedHeightChange: updateCollapsedSheetHeight
            )
        )
        .fileImporter(isPresented: $coordinator.showGpxImporter, allowedContentTypes: [.gpx, .xml]) { result in
            switch result {
            case .success(let url):
                coordinator.loadGpx(from: url)
            case .failure(let error):
                coordinator.gpxError = error.localizedDescription
            }
        }
        .fullScreenCover(isPresented: $coordinator.showSettings) {
            SettingsSheet(
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
        }
    }

    var collapsedPresentationDetentHeight: CGFloat {
        max(72, coordinator.collapsedSheetHeight + 14)
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

    var placeActions: PlaceActions {
        PlaceActions(
            onTeleport: teleportSelectedPlace,
            onRoute: routeToSelectedPlace,
            onAddStop: addSelectedPlaceAsStop,
            onFavorite: favoriteSelectedPlace,
            onCopyCoordinates: copySelectedPlaceCoordinates,
            onDismiss: { coordinator.selectedPlace = nil }
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

    func updateCollapsedSheetHeight(_ newHeight: CGFloat) {
        let roundedHeight = newHeight.rounded(.toNearestOrAwayFromZero)
        if abs(roundedHeight - coordinator.collapsedSheetHeight) > 1 {
            coordinator.collapsedSheetHeight = roundedHeight
            if coordinator.sheetDetent == .collapsed {
                coordinator.nativeSheetDetent = collapsedPresentationDetent
            }
        }
    }

    func teleportSelectedPlace() {
        guard let place = coordinator.selectedPlace, coordinator.requireConnection(session: session) else { return }
        session.engine.setLocation(lat: place.coordinate.latitude, lon: place.coordinate.longitude, name: place.title)
        coordinator.selectedPlace = nil
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
        coordinator.selectedPlace = nil
    }

    func favoriteSelectedPlace() {
        guard let place = coordinator.selectedPlace, coordinator.requireConnection(session: session) else { return }
        session.engine.addFavorite(
            lat: place.coordinate.latitude,
            lon: place.coordinate.longitude,
            name: place.title
        )
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
