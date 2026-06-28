import SwiftUI
import MapKit

/// Reports the search capsule's actual rendered height up to ContentView, so
/// the collapsed detent can hug exactly the search bar — Plans-style — rather
/// than guessing a fixed height that leaves a strip of empty sheet background
/// below the capsule (or worse, clips it) on different dynamic-type sizes.
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

/// Persistent draggable bottom sheet (à la Plans): collapsed it only shows
/// the search field, dragging the slider up reveals search results, the
/// itinerary being built, or favorites — instead of floating cards over the
/// map. The resting row pairs the search capsule with a separate contextual
/// control (gear ⇄ ✕, see `trailingButton`), like Plans' adjacent account or
/// cancel affordance.
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

    @Binding var scrollOffset: CGFloat

    /// The panel's current detent — used to keep the collapsed state to
    /// *just* the search capsule, like Plans. Everything else (favorites,
    /// results, itinerary, place card...) only appears once the panel is
    /// actually dragged/expanded open.
    @Binding var sheetDetent: SheetDetent

    /// The collapsed detent's height, measured live from the header's actual
    /// rendered size (see `HeaderHeightKey`) and reported up via
    /// `onCollapsedHeightChange` so the hosting `FloatingSheet` can size its
    /// collapsed detent to exactly the search capsule.
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

    /// Fallback used only until the header's first layout pass reports its
    /// real height — never the value actually rendered against.
    static let collapsedHeight: CGFloat = 52

    var body: some View {
        VStack(spacing: 10) {
            header
                .background(
                    GeometryReader { proxy in
                        Color.clear.preference(key: HeaderHeightKey.self, value: proxy.size.height)
                    }
                )

            if !isCollapsed {
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
                .onPreferenceChange(ScrollOffsetKey.self) { value in
                    scrollOffset = value
                }
            }

            if !isCollapsed, hasActiveRouteControls {
                activeRouteControlDock
                    .padding(.bottom, 8)
            }
        }
        .onPreferenceChange(HeaderHeightKey.self) { measured in
            if abs(measured - collapsedHeight) > 0.5 {
                onCollapsedHeightChange(measured)
            }
        }
    }

    /// The sheet's expanded content — exactly one of the place card, search
    /// results, the itinerary being built, or an empty/last-itinerary state,
    /// plus the persistent simulation banner and favorites row. Split out of
    /// `body` so each state reads as its own case instead of nested
    /// `if/else` inline.
    @ViewBuilder
    private var mainContent: some View {
        VStack(spacing: 12) {
            // Persistent like Plans' "navigation active" banner — visible
            // regardless of what else is on screen, since pausing/
            // stopping a running simulation is a system-level action.
            if hasGenericSimulationControls {
                simulationControlBar
            }

            // Persistent like the simulation bar — a running patrol is a
            // system-level mode you can stop from anywhere in the sheet.
            if patrol.isActive {
                patrolActiveBar
            }

            if hasActiveRouteControls, let activeRoute = activeRoute {
                activeRouteOverview(activeRoute)
            } else if patrol.isSettingUp {
                // Defining a zone takes over the sheet like the place card —
                // the live dashed preview is drawn on the map underneath.
                PatrolPanel(
                    type: patrol.type,
                    radius: patrol.radius,
                    onLaunch: patrol.onStart,
                    onCancel: patrol.onCancel
                )
            } else if gpx.isLoaded {
                // A picked GPX track takes over the sheet until launched or
                // discarded, same as the patrol setup panel.
                GpxPanel(
                    fileName: gpx.fileName,
                    speed: gpx.speed,
                    onLaunch: gpx.onLaunch,
                    onCancel: gpx.onCancel
                )
            } else if let place = selectedPlace {
                // Selecting a place (search result or map long-press) takes
                // over the sheet's content — this used to float over the
                // map, where the sheet itself could end up covering it;
                // living inside the sheet, it never can.
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
                    searchResultsSection
                } else if !itineraryStops.isEmpty {
                    ItineraryOptions(
                        stops: itineraryStops,
                        speed: $itinerarySpeed,
                        profile: itineraryProfile,
                        totalEstimate: itineraryTotalEstimate,
                        onLaunch: onLaunchItinerary
                    )
                } else {
                    expandedHomeContent
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

    /// What the trailing button in the search capsule does right now. Plans
    /// puts a single contextual control at the trailing edge of its search
    /// field: an account/settings button at rest that morphs into a cancel
    /// affordance the moment there's something to back out of.
    private enum TrailingAction {
        case settings       // sheet is collapsed -> open settings (gear)
        case cancelPlace    // place card is showing -> dismiss it (xmark)
        case cancelSearch   // typing / focused -> clear query and unfocus (xmark)
        case collapseSheet  // sheet is expanded, nothing else in progress -> collapse to minimal (xmark)
    }

    private var trailingAction: TrailingAction {
        if sheetDetent == .collapsed {
            return .settings
        }
        if selectedPlace != nil { return .cancelPlace }
        if isFocused.wrappedValue || !searchQuery.isEmpty { return .cancelSearch }
        return .collapseSheet
    }

    /// Plans-style resting row: a search capsule plus a separate round
    /// settings/cancel control, instead of embedding that control in the field.
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
                activeRouteCompactHeader(activeRoute)
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
        HStack(spacing: 9) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)

            TextField(!itineraryStops.isEmpty ? "Ajouter un arrêt..." : "Rechercher une adresse", text: $searchQuery)
                .focused(isFocused)
                .submitLabel(.search)
        }
        .padding(.horizontal, 13)
        .padding(.vertical, 8)
        .frame(minHeight: 44)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular.interactive(), in: .capsule)
    }

    /// The gear ⇄ ✕ control. The symbol swaps in place (`.replace`) so it
    /// reads as one button changing role, not two buttons appearing and
    /// disappearing — matching how Plans' trailing control morphs.
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
                withAnimation(.interactiveSpring(response: 0.28, dampingFraction: 0.88)) {
                    sheetDetent = .collapsed
                }
            }
        } label: {
            Image(systemName: action == .settings ? "gearshape.fill" : "xmark.circle.fill")
                .font(action == .settings ? .body.weight(.semibold) : .title3.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 44, height: 44)
                .contentShape(Circle())
                .contentTransition(.symbolEffect(.replace))
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: Circle())
        .accessibilityLabel(action == .settings ? "Réglages" : "Annuler")
        .animation(.snappy(duration: 0.2), value: action)
    }
}
