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

    /// The panel's current detent — used to keep the collapsed state to
    /// *just* the search capsule, like Plans. Everything else (favorites,
    /// results, itinerary, place card...) only appears once the panel is
    /// actually dragged/expanded open.
    var sheetDetent: SheetDetent

    /// The collapsed detent's height, measured live from the header's actual
    /// rendered size (see `HeaderHeightKey`) and reported up via
    /// `onCollapsedHeightChange` so the hosting `FloatingSheet` can size its
    /// collapsed detent to exactly the search capsule.
    var collapsedHeight: CGFloat
    var onCollapsedHeightChange: (CGFloat) -> Void

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
                    ItineraryPanel(
                        stops: $itineraryStops,
                        speed: $itinerarySpeed,
                        profile: $itineraryProfile,
                        legEstimates: legEstimates,
                        totalEstimate: itineraryTotalEstimate,
                        onAddStop: onAddStop,
                        onLaunch: onLaunchItinerary,
                        onCancel: { itineraryStops = [] }
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
        case settings    // nothing in progress → open Réglages (the gear)
        case cancelPlace // a place card is showing → dismiss it
        case cancelSearch // typing / focused → clear the query and unfocus
    }

    private var trailingAction: TrailingAction {
        if selectedPlace != nil { return .cancelPlace }
        if isFocused.wrappedValue || !searchQuery.isEmpty { return .cancelSearch }
        return .settings
    }

    private var expandedHomeContent: some View {
        VStack(alignment: .leading, spacing: 18) {
            quickActionsSection
            placesSection
            if hasSavedItinerary || !recentPlaces.isEmpty {
                recentsSection
            }
            guidesSection
            utilitySection
        }
        .padding(.top, 2)
    }

    private var quickActionsSection: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 18) {
                homeShortcutButton("Parcours GPX", icon: "doc.badge.plus", isPrimary: true, action: gpx.onPick)
                if !patrol.isActive {
                    homeShortcutButton("Patrouille", icon: "shield.lefthalf.filled", action: patrol.onBegin)
                }
                homeShortcutButton("Ajouter", icon: "plus", action: focusSearchForAddition)
            }
            .padding(.horizontal, 18)
        }
    }

    private var placesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader("Lieux") {
                Button(action: focusSearchForAddition) {
                    Label("Ajouter un lieu", systemImage: "plus.circle.fill")
                        .labelStyle(.iconOnly)
                        .font(.title3.weight(.semibold))
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color.accentColor)
            }

            if favorites.isEmpty {
                emptyFavoritesCard
            } else {
                favoriteListCard
            }
        }
        .padding(.horizontal, 16)
    }

    private var recentsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader("Récents") {
                if !recentPlaces.isEmpty {
                    Button("Effacer", action: onClearRecentPlaces)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Color.accentColor)
                }
            }
            groupedActionList {
                if hasSavedItinerary {
                    utilityRow(
                        "Dernier itinéraire",
                        subtitle: "Charger l’itinéraire enregistré",
                        icon: "clock.arrow.circlepath",
                        action: onLoadLastItinerary
                    )
                    if !recentPlaces.isEmpty {
                        Divider().padding(.leading, 58)
                    }
                }

                ForEach(recentPlaces.prefix(5)) { recent in
                    recentPlaceRow(recent)
                    if recent.id != recentPlaces.prefix(5).last?.id {
                        Divider().padding(.leading, 58)
                    }
                }
            }
        }
        .padding(.horizontal, 16)
    }

    private var guidesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader("Vos guides")
            guideCard(
                title: "Favoris",
                subtitle: favorites.isEmpty ? "Aucun lieu enregistré" : "\(favorites.count) lieu\(favorites.count > 1 ? "x" : "")",
                icon: "star.fill"
            )
        }
        .padding(.horizontal, 16)
    }

    private var utilitySection: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader("Plus")
            groupedActionList {
                utilityRow(
                    "Rechercher ou ajouter un lieu",
                    subtitle: "Créer un favori depuis la recherche",
                    icon: "mappin.and.ellipse",
                    action: focusSearchForAddition
                )
                Divider().padding(.leading, 58)
                utilityRow(
                    "Réglages de connexion",
                    subtitle: "Connexion, appareil et préférences",
                    icon: "gearshape.fill",
                    action: onOpenSettings
                )
                Divider().padding(.leading, 58)
                utilityRow(
                    "Signaler un problème",
                    subtitle: "Ouvrir les diagnostics de l’app",
                    icon: "exclamationmark.bubble.fill",
                    action: onOpenSettings
                )
            }
        }
        .padding(.horizontal, 16)
    }

    /// Plans-style resting row: a search capsule plus a separate round
    /// settings/cancel control, instead of embedding that control in the field.
    private var header: some View {
        Group {
            if hasActiveRouteControls, let activeRoute = activeRoute {
                activeRouteCompactHeader(activeRoute)
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

            TextField("Rechercher une adresse", text: $searchQuery)
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

    var visibleFavorites: [Favorite] {
        favorites
    }

    func focusSearchForAddition() {
        searchQuery = ""
        isFocused.wrappedValue = true
    }

    private func homeShortcutButton(_ title: String, icon: String, isPrimary: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(isPrimary ? Color.white : Color.accentColor)
                    .frame(width: 64, height: 64)
                    .background(isPrimary ? Color.accentColor : Color(.secondarySystemFill), in: Circle())

                Text(title)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.78)
            }
            .frame(width: 82)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
    }
}
