import SwiftUI
import MapKit

private struct HeaderHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = BottomSheet.collapsedHeight
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

private struct ScrollOffsetKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

struct BottomSheet: View {
    @Binding var searchQuery: String
    var isFocused: FocusState<Bool>.Binding
    let searchSuggestions: [MKLocalSearchCompletion]
    var onSelectSuggestion: (MKLocalSearchCompletion) -> Void

    @Binding var itineraryStops: [RouteStop]
    @Binding var itinerarySpeed: Double
    @Binding var itineraryProfile: String
    let legEstimates: [UUID: LegEstimate]
    let activeRoute: ActiveRoute?
    var onAddStop: () -> Void
    var onLaunchItinerary: () -> Void
    var onShowActiveRouteDetails: () -> Void
    var onRecenterActiveRoute: () -> Void

    let favorites: [Favorite]
    var onSelectFavorite: (Favorite) -> Void
    var onDeleteFavorite: (Favorite) -> Void
    let recentPlaces: [RecentPlace]
    var onSelectRecentPlace: (RecentPlace) -> Void
    var onClearRecentPlaces: () -> Void

    let hasSavedItinerary: Bool
    var onLoadLastItinerary: () -> Void

    let selectedPlace: SelectedPlace?
    var placeActions: PlaceActions

    var patrol: PatrolControls

    var gpx: GpxImport

    let simulationState: String?
    var onPauseRoute: () -> Void
    var onResumeRoute: () -> Void
    var onStopRoute: () -> Void

    var onOpenSettings: () -> Void
    var onCollapseSheet: () -> Void

    @Binding var scrollOffset: CGFloat
    @Binding var sheetDetent: SheetDetent
    var collapsedHeight: CGFloat
    var onCollapsedHeightChange: (CGFloat) -> Void

    init(
        searchQuery: Binding<String>,
        isFocused: FocusState<Bool>.Binding,
        searchSuggestions: [MKLocalSearchCompletion],
        onSelectSuggestion: @escaping (MKLocalSearchCompletion) -> Void,
        itineraryStops: Binding<[RouteStop]>,
        itinerarySpeed: Binding<Double>,
        itineraryProfile: Binding<String>,
        legEstimates: [UUID: LegEstimate],
        activeRoute: ActiveRoute?,
        onAddStop: @escaping () -> Void,
        onLaunchItinerary: @escaping () -> Void,
        onShowActiveRouteDetails: @escaping () -> Void,
        onRecenterActiveRoute: @escaping () -> Void,
        favorites: [Favorite],
        onSelectFavorite: @escaping (Favorite) -> Void,
        onDeleteFavorite: @escaping (Favorite) -> Void,
        recentPlaces: [RecentPlace],
        onSelectRecentPlace: @escaping (RecentPlace) -> Void,
        onClearRecentPlaces: @escaping () -> Void,
        hasSavedItinerary: Bool,
        onLoadLastItinerary: @escaping () -> Void,
        selectedPlace: SelectedPlace?,
        placeActions: PlaceActions,
        patrol: PatrolControls,
        gpx: GpxImport,
        simulationState: String?,
        onPauseRoute: @escaping () -> Void,
        onResumeRoute: @escaping () -> Void,
        onStopRoute: @escaping () -> Void,
        onOpenSettings: @escaping () -> Void,
        onCollapseSheet: @escaping () -> Void,
        scrollOffset: Binding<CGFloat>,
        sheetDetent: Binding<SheetDetent>,
        collapsedHeight: CGFloat,
        onCollapsedHeightChange: @escaping (CGFloat) -> Void
    ) {
        self._searchQuery = searchQuery
        self.isFocused = isFocused
        self.searchSuggestions = searchSuggestions
        self.onSelectSuggestion = onSelectSuggestion
        self._itineraryStops = itineraryStops
        self._itinerarySpeed = itinerarySpeed
        self._itineraryProfile = itineraryProfile
        self.legEstimates = legEstimates
        self.activeRoute = activeRoute
        self.onAddStop = onAddStop
        self.onLaunchItinerary = onLaunchItinerary
        self.onShowActiveRouteDetails = onShowActiveRouteDetails
        self.onRecenterActiveRoute = onRecenterActiveRoute
        self.favorites = favorites
        self.onSelectFavorite = onSelectFavorite
        self.onDeleteFavorite = onDeleteFavorite
        self.recentPlaces = recentPlaces
        self.onSelectRecentPlace = onSelectRecentPlace
        self.onClearRecentPlaces = onClearRecentPlaces
        self.hasSavedItinerary = hasSavedItinerary
        self.onLoadLastItinerary = onLoadLastItinerary
        self.selectedPlace = selectedPlace
        self.placeActions = placeActions
        self.patrol = patrol
        self.gpx = gpx
        self.simulationState = simulationState
        self.onPauseRoute = onPauseRoute
        self.onResumeRoute = onResumeRoute
        self.onStopRoute = onStopRoute
        self.onOpenSettings = onOpenSettings
        self.onCollapseSheet = onCollapseSheet
        self._scrollOffset = scrollOffset
        self._sheetDetent = sheetDetent
        self.collapsedHeight = collapsedHeight
        self.onCollapsedHeightChange = onCollapsedHeightChange
    }

    private var isSearching: Bool {
        !searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var isCollapsed: Bool {
        sheetDetent == .collapsed
    }

    static let collapsedHeight: CGFloat = 52

    var body: some View {
        VStack(spacing: 0) {
            header
                .background(
                    GeometryReader { proxy in
                        Color.clear.preference(key: HeaderHeightKey.self, value: proxy.size.height)
                    }
                )

            if !isCollapsed {
                scrollableContent
                    .padding(.top, 10)
                    .transition(.opacity)
            }

            if !isCollapsed, hasActiveRouteControls {
                BottomSheetActiveRouteControlDockView(
                    simulationState: simulationState,
                    onResumeRoute: onResumeRoute,
                    onPauseRoute: onPauseRoute,
                    onStopRoute: onStopRoute,
                    onRecenterActiveRoute: onRecenterActiveRoute,
                    onShowActiveRouteDetails: onShowActiveRouteDetails,
                    onOpenSettings: onOpenSettings
                )
                .padding(.top, 10)
                .padding(.bottom, 8)
            }
        }
        .onPreferenceChange(HeaderHeightKey.self) { measured in
            let rounded = measured.rounded(.toNearestOrAwayFromZero)
            if abs(rounded - collapsedHeight) > 1 {
                onCollapsedHeightChange(rounded)
            }
        }
    }

    private var scrollableContent: some View {
        ScrollView {
            mainContent
                .padding(.bottom, hasActiveRouteControls ? 8 : 24)
                .background(
                    GeometryReader { proxy in
                        let offsetY = proxy.frame(in: .named("scroll")).minY
                        Color.clear
                            .preference(key: ScrollOffsetKey.self, value: offsetY)
                    }
                )
        }
        .coordinateSpace(name: "scroll")
        .scrollDisabled(sheetDetent != .large)
        .scrollDismissesKeyboard(.interactively)
        .onPreferenceChange(ScrollOffsetKey.self) { value in
            scrollOffset = value
        }
    }

    @ViewBuilder
    private var mainContent: some View {
        VStack(spacing: 12) {
            if hasGenericSimulationControls {
                SimulationControlBarView(
                    simulationState: simulationState,
                    onResumeRoute: onResumeRoute,
                    onPauseRoute: onPauseRoute,
                    onStopRoute: onStopRoute
                )
            }

            if patrol.isActive {
                PatrolActiveBarView(patrol: patrol)
            }

            if hasActiveRouteControls, let activeRoute = activeRoute {
                BottomSheetActiveRouteControlsView(
                    route: activeRoute,
                    simulationState: simulationState,
                    selectedPlace: selectedPlace,
                    placeActions: placeActions,
                    favorites: favorites,
                    onResumeRoute: onResumeRoute,
                    onPauseRoute: onPauseRoute,
                    onStopRoute: onStopRoute,
                    onRecenterActiveRoute: onRecenterActiveRoute,
                    onShowActiveRouteDetails: onShowActiveRouteDetails,
                    onOpenSettings: onOpenSettings
                )
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
            } else if let place = selectedPlace {
                PlaceCard(
                    place: place,
                    isFavorite: isFavorite(place),
                    onTeleport: placeActions.onTeleport,
                    onRoute: placeActions.onRoute,
                    onAddStop: placeActions.onAddStop,
                    onFavorite: placeActions.onFavorite,
                    onCopyCoordinates: placeActions.onCopyCoordinates,
                    onDismiss: placeActions.onDismiss
                )
            } else {
                if isSearching {
                    BottomSheetSearchResultsView(
                        searchSuggestions: searchSuggestions,
                        onSelectSuggestion: onSelectSuggestion
                    )
                } else if !itineraryStops.isEmpty {
                    ItineraryOptions(
                        stops: itineraryStops,
                        speed: $itinerarySpeed,
                        profile: itineraryProfile,
                        totalEstimate: itineraryTotalEstimate,
                        onLaunch: onLaunchItinerary
                    )
                } else {
                    BottomSheetHomeView(
                        favorites: favorites,
                        recentPlaces: recentPlaces,
                        hasSavedItinerary: hasSavedItinerary,
                        patrol: patrol,
                        gpx: gpx,
                        onSelectFavorite: onSelectFavorite,
                        onDeleteFavorite: onDeleteFavorite,
                        onSelectRecentPlace: onSelectRecentPlace,
                        onClearRecentPlaces: onClearRecentPlaces,
                        onLoadLastItinerary: onLoadLastItinerary,
                        onOpenSettings: onOpenSettings,
                        searchQuery: $searchQuery,
                        isFocused: isFocused
                    )
                    if let gpxError = gpx.errorMessage {
                        Text(gpxError)
                            .font(.caption)
                            .foregroundStyle(.red)
                            .padding(.horizontal, 16)
                    }
                }
            }
        }
    }

    private enum TrailingAction {
        case settings
        case cancelPlace
        case cancelSearch
        case collapseSheet
    }

    private var trailingAction: TrailingAction {
        if sheetDetent == .collapsed {
            return .settings
        }
        if selectedPlace != nil { return .cancelPlace }
        if isFocused.wrappedValue || !searchQuery.isEmpty { return .cancelSearch }
        return .collapseSheet
    }

    private var itineraryPlanningHeader: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Itinéraire")
                    .font(.title3.weight(.bold))
                Spacer()
                Button {
                    withAnimation {
                        itineraryStops = []
                    }
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 4)

            ItineraryHeader(
                stops: $itineraryStops,
                profile: $itineraryProfile,
                legEstimates: legEstimates,
                onAddStop: onAddStop
            )
        }
        .padding(.top, 4)
    }

    private var header: some View {
        Group {
            if hasActiveRouteControls, let activeRoute = activeRoute {
                BottomSheetActiveRouteHeaderView(
                    route: activeRoute,
                    simulationState: simulationState,
                    onShowActiveRouteDetails: onShowActiveRouteDetails
                )
            } else if !itineraryStops.isEmpty && !isFocused.wrappedValue {
                itineraryPlanningHeader
            } else {
                HStack(spacing: 10) {
                    searchField
                    trailingButton
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 4)
    }

    private var searchField: some View {
        BottomSheetSearchField(
            searchQuery: $searchQuery,
            isFocused: isFocused,
            hasItineraryStops: !itineraryStops.isEmpty
        )
    }

    private var trailingButton: some View {
        let action = trailingAction
        return Button {
            switch action {
            case .settings:
                onOpenSettings()
            case .cancelPlace:
                placeActions.onDismiss()
            case .cancelSearch:
                searchQuery = ""
                isFocused.wrappedValue = false
            case .collapseSheet:
                onCollapseSheet()
            }
        } label: {
            Group {
                if action == .settings {
                    Text("DR")
                        .font(.title3.weight(.bold))
                        .foregroundStyle(.white)
                        .minimumScaleFactor(0.75)
                } else {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .contentTransition(.symbolEffect(.replace))
                }
            }
            .frame(width: 58, height: 58)
            .contentShape(Circle())
            .background {
                if action == .settings {
                    Circle().fill(.indigo.opacity(0.82))
                }
            }
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: Circle())
        .accessibilityLabel(action == .settings ? "Réglages" : "Annuler")
        .animation(.snappy(duration: 0.2), value: action)
    }

    private var hasActiveRouteControls: Bool {
        activeRoute != nil
    }

    private var hasGenericSimulationControls: Bool {
        activeRoute == nil && (simulationState == "moving" || simulationState == "paused")
    }

    private var itineraryTotalEstimate: LegEstimate? {
        let estimates = itineraryStops.compactMap { legEstimates[$0.id] }
        guard !estimates.isEmpty else { return nil }
        return LegEstimate(
            distanceMeters: estimates.reduce(0) { $0 + $1.distanceMeters },
            travelTime: estimates.reduce(0) { $0 + $1.travelTime }
        )
    }

    private func isFavorite(_ place: SelectedPlace) -> Bool {
        favorites.contains { favorite in
            abs(favorite.lat - place.coordinate.latitude) < 0.000001
                && abs(favorite.lon - place.coordinate.longitude) < 0.000001
        }
    }
}

private struct BottomSheetSearchField: View {
    @Binding var searchQuery: String
    var isFocused: FocusState<Bool>.Binding
    let hasItineraryStops: Bool

    var body: some View {
        HStack(spacing: 9) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
                .font(.title3.weight(.semibold))
                .accessibilityHidden(true)

            TextField(hasItineraryStops ? "Ajouter un arrêt..." : "Rechercher une adresse", text: $searchQuery)
                .focused(isFocused)
                .submitLabel(.search)
                .font(.title3.weight(.semibold))

            Button {
                isFocused.wrappedValue = true
            } label: {
                Image(systemName: "mic.fill")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 44, height: 44)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Recherche vocale")
        }
        .padding(.leading, 20)
        .padding(.trailing, 8)
        .frame(minHeight: 58)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular.interactive(), in: .capsule)
    }
}
