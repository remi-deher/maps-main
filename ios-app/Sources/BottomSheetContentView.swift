import SwiftUI

struct BottomSheetContentView: View {
    let search: BottomSheetSearchContext
    let itinerary: BottomSheetItineraryContext
    let library: BottomSheetLibraryContext
    let place: BottomSheetPlaceContext
    let patrol: PatrolControls
    let gpx: GpxImport
    let simulation: BottomSheetSimulationContext
    let chrome: BottomSheetChromeContext

    private var isSearching: Bool {
        !search.query.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var hasActiveRouteControls: Bool {
        itinerary.activeRoute != nil
    }

    private var hasGenericSimulationControls: Bool {
        itinerary.activeRoute == nil && (simulation.state == "moving" || simulation.state == "paused")
    }

    private var itineraryTotalEstimate: LegEstimate? {
        let estimates = itinerary.stops.wrappedValue.compactMap { itinerary.legEstimates[$0.id] }
        guard !estimates.isEmpty else { return nil }
        return LegEstimate(
            distanceMeters: estimates.reduce(0) { $0 + $1.distanceMeters },
            travelTime: estimates.reduce(0) { $0 + $1.travelTime }
        )
    }

    var body: some View {
        VStack(spacing: 12) {
            if hasGenericSimulationControls {
                SimulationControlBarView(
                    simulationState: simulation.state,
                    onResumeRoute: simulation.onResumeRoute,
                    onPauseRoute: simulation.onPauseRoute,
                    onStopRoute: simulation.onStopRoute
                )
            }

            if patrol.isActive {
                PatrolActiveBarView(patrol: patrol)
            }

            mainPanel
        }
    }

    @ViewBuilder
    private var mainPanel: some View {
        if hasActiveRouteControls, let activeRoute = itinerary.activeRoute {
            activeRouteControls(activeRoute)
        } else if patrol.isSettingUp {
            PatrolPanel(
                type: patrol.type,
                radius: patrol.radius,
                onLaunch: patrol.onStart,
                onCancel: patrol.onCancel
            )
        } else if gpx.isLoaded {
            GpxPanel(
                fileName: gpx.fileName,
                speed: gpx.speed,
                onLaunch: gpx.onLaunch,
                onCancel: gpx.onCancel
            )
        } else if let selectedPlace = place.selectedPlace {
            placeCard(selectedPlace)
        } else if isSearching {
            BottomSheetSearchResultsView(
                searchSuggestions: search.suggestions,
                onSelectSuggestion: search.onSelectSuggestion
            )
        } else if !itinerary.stops.wrappedValue.isEmpty {
            ItineraryOptions(
                stops: itinerary.stops.wrappedValue,
                speed: itinerary.speed,
                profile: itinerary.profile.wrappedValue,
                totalEstimate: itineraryTotalEstimate,
                onLaunch: itinerary.onLaunch
            )
        } else {
            homeContent
        }
    }

    private func activeRouteControls(_ activeRoute: ActiveRoute) -> some View {
        BottomSheetActiveRouteControlsView(
            route: activeRoute,
            simulationState: simulation.state,
            selectedPlace: place.selectedPlace,
            placeActions: place.actions,
            favorites: library.favorites,
            onResumeRoute: simulation.onResumeRoute,
            onPauseRoute: simulation.onPauseRoute,
            onStopRoute: simulation.onStopRoute,
            onRecenterActiveRoute: itinerary.onRecenterActiveRoute,
            onShowActiveRouteDetails: itinerary.onShowActiveRouteDetails,
            onOpenSettings: chrome.onOpenSettings
        )
    }

    private func placeCard(_ selectedPlace: SelectedPlace) -> some View {
        PlaceCard(
            place: selectedPlace,
            isFavorite: isFavorite(selectedPlace),
            onTeleport: place.actions.onTeleport,
            onRoute: place.actions.onRoute,
            onAddStop: place.actions.onAddStop,
            onFavorite: place.actions.onFavorite,
            onCopyCoordinates: place.actions.onCopyCoordinates,
            onDismiss: place.actions.onDismiss
        )
    }

    private var homeContent: some View {
        VStack(spacing: 12) {
            BottomSheetHomeView(
                favorites: library.favorites,
                recentPlaces: library.recentPlaces,
                hasSavedItinerary: library.hasSavedItinerary,
                patrol: patrol,
                gpx: gpx,
                onSelectFavorite: library.onSelectFavorite,
                onDeleteFavorite: library.onDeleteFavorite,
                onSelectRecentPlace: library.onSelectRecentPlace,
                onClearRecentPlaces: library.onClearRecentPlaces,
                onLoadLastItinerary: library.onLoadLastItinerary,
                onOpenSettings: chrome.onOpenSettings,
                searchQuery: search.query,
                isFocused: search.isFocused
            )

            if let gpxError = gpx.errorMessage {
                Text(gpxError)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .padding(.horizontal, 16)
            }
        }
    }

    private func isFavorite(_ selectedPlace: SelectedPlace) -> Bool {
        library.favorites.contains { favorite in
            abs(favorite.lat - selectedPlace.coordinate.latitude) < 0.000001
                && abs(favorite.lon - selectedPlace.coordinate.longitude) < 0.000001
        }
    }
}
