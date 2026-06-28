import SwiftUI
import UIKit
import UniformTypeIdentifiers

extension ContentView {
    /// The persistent panel's content, hosted by the system sheet. Kept out of
    /// ContentView.swift so the root view reads as the app shell instead of a
    /// long dependency-wiring block.
    func bottomSheetContent(scrollOffset: Binding<CGFloat>) -> some View {
        BottomSheet(
            searchQuery: $searchQuery,
            isFocused: $searchFocused,
            searchSuggestions: searchCompleter.results,
            onSelectSuggestion: selectSearchSuggestion,
            itineraryStops: $itineraryStops,
            itinerarySpeed: $itinerarySpeed,
            itineraryProfile: $itineraryProfile,
            legEstimates: session.legEstimates,
            activeRoute: activeRoute,
            onAddStop: { searchFocused = true },
            onLaunchItinerary: launchItinerary,
            onShowActiveRouteDetails: showActiveRouteDetails,
            onRecenterActiveRoute: recenterActiveRoute,
            favorites: session.engine.status?.favorites ?? [],
            onSelectFavorite: selectFavorite,
            onDeleteFavorite: { favorite in
                session.engine.removeFavorite(lat: favorite.lat, lon: favorite.lon)
            },
            recentPlaces: recentPlaces,
            onSelectRecentPlace: selectRecentPlace,
            onClearRecentPlaces: clearRecentPlaces,
            hasSavedItinerary: hasSavedItinerary,
            onLoadLastItinerary: loadLastItinerary,
            selectedPlace: selectedPlace,
            placeActions: placeActions,
            patrol: patrolControls,
            gpx: gpxImport,
            simulationState: session.engine.status?.state,
            onPauseRoute: pauseActiveRoute,
            onResumeRoute: resumeActiveRoute,
            onStopRoute: stopActiveRoute,
            onOpenSettings: { showSettings = true },
            scrollOffset: scrollOffset,
            sheetDetent: $sheetDetent,
            collapsedHeight: collapsedSheetHeight,
            onCollapsedHeightChange: updateCollapsedSheetHeight
        )
        .fileImporter(isPresented: $showGpxImporter, allowedContentTypes: [.gpx, .xml]) { result in
            switch result {
            case .success(let url):
                loadGpx(from: url)
            case .failure(let error):
                gpxError = error.localizedDescription
            }
        }
        .fullScreenCover(isPresented: $showSettings) {
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
    }

    var collapsedPresentationDetentHeight: CGFloat {
        max(72, collapsedSheetHeight + 14)
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
        if nativeSheetDetent != target {
            nativeSheetDetent = target
        }
    }

    func syncSheetDetent(to presentationDetent: PresentationDetent) {
        let target = sheetDetent(for: presentationDetent)
        if sheetDetent != target {
            sheetDetent = target
        }
    }

    var placeActions: PlaceActions {
        PlaceActions(
            onTeleport: teleportSelectedPlace,
            onRoute: routeToSelectedPlace,
            onAddStop: addSelectedPlaceAsStop,
            onFavorite: favoriteSelectedPlace,
            onCopyCoordinates: copySelectedPlaceCoordinates,
            onDismiss: { selectedPlace = nil }
        )
    }

    var patrolControls: PatrolControls {
        PatrolControls(
            isSettingUp: patrolMode,
            isActive: session.engine.status?.patrolZone?.active == true,
            type: $patrolType,
            radius: $patrolRadius,
            onBegin: beginPatrolSetup,
            onStart: commitPatrolSetup,
            onCancel: { patrolMode = false },
            onStop: stopPatrol
        )
    }

    var gpxImport: GpxImport {
        GpxImport(
            isLoaded: !gpxContent.isEmpty,
            fileName: gpxFileName,
            errorMessage: gpxError,
            speed: $gpxSpeed,
            onPick: pickGpxFile,
            onLaunch: launchGpxTrack,
            onCancel: clearGpxTrack
        )
    }

    func updateCollapsedSheetHeight(_ newHeight: CGFloat) {
        let roundedHeight = newHeight.rounded(.toNearestOrAwayFromZero)
        if abs(roundedHeight - collapsedSheetHeight) > 1 {
            collapsedSheetHeight = roundedHeight
            if sheetDetent == .collapsed {
                nativeSheetDetent = collapsedPresentationDetent
            }
        }
    }

    func teleportSelectedPlace() {
        guard let place = selectedPlace, requireConnection() else { return }
        session.engine.setLocation(lat: place.coordinate.latitude, lon: place.coordinate.longitude)
        selectedPlace = nil
    }

    func routeToSelectedPlace() {
        guard let place = selectedPlace else { return }
        startRoute(to: place)
    }

    func addSelectedPlaceAsStop() {
        guard let place = selectedPlace else { return }
        if activeRoute != nil {
            addSelectedPlaceToActiveRoute()
            return
        }
        itineraryStops.append(RouteStop(coordinate: place.coordinate, name: place.title))
        selectedPlace = nil
    }

    func favoriteSelectedPlace() {
        guard let place = selectedPlace, requireConnection() else { return }
        session.engine.addFavorite(
            lat: place.coordinate.latitude,
            lon: place.coordinate.longitude,
            name: place.title
        )
    }

    func copySelectedPlaceCoordinates() {
        guard let place = selectedPlace else { return }
        UIPasteboard.general.string = String(
            format: "%.6f, %.6f",
            place.coordinate.latitude,
            place.coordinate.longitude
        )
    }

    func beginPatrolSetup() {
        patrolMode = true
        withAnimation { sheetDetent = .medium }
    }

    func commitPatrolSetup() {
        startPatrol()
        patrolMode = false
    }

    func stopPatrol() {
        session.engine.updatePatrolZone(
            type: patrolType,
            center: nil,
            radius: nil,
            bounds: nil,
            active: false
        )
    }

    func pickGpxFile() {
        gpxError = nil
        showGpxImporter = true
    }

    func launchGpxTrack() {
        session.engine.playCustomGpx(gpxContent: gpxContent, speed: gpxSpeed)
        clearGpxTrack()
    }

    func clearGpxTrack() {
        gpxContent = ""
        gpxFileName = ""
    }
}
