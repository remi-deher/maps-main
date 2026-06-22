import SwiftUI
import MapKit

/// The five actions the place card (PlaceCard) can trigger, grouped into one
/// value instead of five separate closure parameters on BottomSheet's
/// initializer — ContentView builds this once from `selectedPlace`'s
/// handlers, keeping the call site readable.
struct PlaceActions {
    var onTeleport: () -> Void
    var onRoute: () -> Void
    var onAddStop: () -> Void
    var onFavorite: () -> Void
    var onDismiss: () -> Void
}

/// Patrol-zone state and actions, grouped into one value so they don't balloon
/// BottomSheet's initializer. ContentView owns the underlying state and drives
/// the live map preview; the sheet just renders the setup panel, the active
/// banner, and the entry button. Promoting this out of Réglages lets the zone
/// be framed against the map instead of configured blind in a settings form.
struct PatrolControls {
    /// True while the user is defining a zone (the setup panel is showing).
    var isSettingUp: Bool
    /// True while a patrol is running (the persistent active banner shows).
    var isActive: Bool
    var type: Binding<String>
    var radius: Binding<Double>
    /// Enter setup mode from the sheet's empty state.
    var onBegin: () -> Void
    /// Commit the defined zone and start patrolling.
    var onStart: () -> Void
    /// Leave setup mode without starting.
    var onCancel: () -> Void
    /// Stop a running patrol.
    var onStop: () -> Void
}

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
/// map. The search capsule carries one contextual trailing control (gear ⇄ ✕,
/// see `trailingButton`), exactly like Plans' account/cancel button — a gear
/// that opens Réglages at rest, a cancel affordance once there's a search or a
/// selected place to back out of.
struct BottomSheet: View {
    @Binding var searchQuery: String
    var isFocused: FocusState<Bool>.Binding
    let searchSuggestions: [MKLocalSearchCompletion]
    var onSelectSuggestion: (MKLocalSearchCompletion) -> Void

    @Binding var itineraryStops: [RouteStop]
    @Binding var itinerarySpeed: Double
    @Binding var itineraryProfile: String
    let legEstimates: [UUID: LegEstimate]
    var onAddStop: () -> Void
    var onLaunchItinerary: () -> Void

    let favorites: [Favorite]
    var onSelectFavorite: (Favorite) -> Void
    var onDeleteFavorite: (Favorite) -> Void

    let hasSavedItinerary: Bool
    var onLoadLastItinerary: () -> Void

    let selectedPlace: SelectedPlace?
    var placeActions: PlaceActions

    var patrol: PatrolControls

    let simulationState: String?
    var onPauseRoute: () -> Void
    var onResumeRoute: () -> Void
    var onStopRoute: () -> Void

    var onOpenSettings: () -> Void

    /// Live engine link state + anti-drift drift, surfaced as a discreet
    /// banner right under the search capsule instead of being buried in
    /// Réglages › Connexion (§3.9 of docs/UI_UX_BASELINE.md). The banner only
    /// appears when there's something worth saying — link lost/connecting, or
    /// the spoof has drifted past the warning threshold — so the happy,
    /// connected-and-steady case stays just the search bar.
    let connectionState: EngineConnectionState
    let driftMeters: Double?
    var onConnect: () -> Void

    /// The sheet's current detent — used to keep the collapsed state to
    /// *just* the search capsule, like Plans. Everything else (favorites,
    /// results, itinerary, place card...) only appears once the sheet is
    /// actually dragged/expanded open.
    var sheetDetent: PresentationDetent

    /// The collapsed detent's height, measured live from the header's actual
    /// rendered size (see `HeaderHeightKey`) and reported up via
    /// `onCollapsedHeightChange` so ContentView can keep its
    /// `.presentationDetents` / `sheetDetent` in sync.
    var collapsedHeight: CGFloat
    var onCollapsedHeightChange: (CGFloat) -> Void

    private var isSearching: Bool {
        !searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var isCollapsed: Bool {
        sheetDetent == .height(collapsedHeight)
    }

    /// Fallback used only until the header's first layout pass reports its
    /// real height — never the value actually rendered against.
    static let collapsedHeight: CGFloat = 120

    var body: some View {
        VStack(spacing: 14) {
            // Header + status banner form the always-visible top region, even
            // when collapsed — so a dropped link is never hidden behind a
            // collapsed handle. Both are measured together so the collapsed
            // detent grows/shrinks to fit the banner as it appears/disappears.
            VStack(spacing: 10) {
                header
                statusBanner
            }
            .background(
                GeometryReader { proxy in
                    Color.clear.preference(key: HeaderHeightKey.self, value: proxy.size.height)
                }
            )

            if !isCollapsed {
                ScrollView {
                    mainContent
                        .padding(.bottom, 24)
                }
            }
        }
        .padding(.top, 8)
        .onPreferenceChange(HeaderHeightKey.self) { measured in
            let height = measured + 8
            if abs(height - collapsedHeight) > 0.5 {
                onCollapsedHeightChange(height)
            }
        }
    }

    /// Threshold past which the anti-drift gap is worth warning about — matches
    /// the orange cutoff already used in Réglages › Connexion's drift row.
    private static let driftWarningThreshold: Double = 100

    /// Nothing while connected and steady; a link-state banner when the engine
    /// isn't connected; a drift warning when connected but the spoof has
    /// wandered too far from the device's real position.
    @ViewBuilder
    private var statusBanner: some View {
        switch connectionState {
        case .connected:
            if let drift = driftMeters, drift > Self.driftWarningThreshold {
                bannerRow(
                    icon: "scope",
                    tint: .orange,
                    title: "Dérive élevée : \(Int(drift)) m",
                    action: nil
                )
            }
        case .connecting:
            bannerRow(icon: "antenna.radiowaves.left.and.right", tint: .secondary, title: "Connexion au moteur…", action: nil)
        case .reconnecting:
            bannerRow(icon: "antenna.radiowaves.left.and.right", tint: .orange, title: "Reconnexion au moteur…", action: nil)
        case .disconnected:
            bannerRow(icon: "bolt.horizontal.circle", tint: .orange, title: "Moteur déconnecté", action: ("Connecter", onConnect))
        }
    }

    /// One discreet glass row: a tinted status icon, a label, and an optional
    /// trailing action button (e.g. "Connecter"). Kept compact since it shares
    /// the always-visible top region with the search capsule.
    @ViewBuilder
    private func bannerRow(icon: String, tint: Color, title: String, action: (label: String, run: () -> Void)?) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .foregroundStyle(tint)
            Text(title)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Spacer()
            if let action {
                Button(action.label, action: action.run)
                    .font(.subheadline.weight(.semibold))
                    .buttonStyle(.glass)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .adaptiveGlassEffect(in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .padding(.horizontal, 16)
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
            if simulationState == "moving" || simulationState == "paused" {
                simulationControlBar
            }

            // Persistent like the simulation bar — a running patrol is a
            // system-level mode you can stop from anywhere in the sheet.
            if patrol.isActive {
                patrolActiveBar
            }

            if patrol.isSettingUp {
                // Defining a zone takes over the sheet like the place card —
                // the live dashed preview is drawn on the map underneath.
                PatrolPanel(
                    type: patrol.type,
                    radius: patrol.radius,
                    onLaunch: patrol.onStart,
                    onCancel: patrol.onCancel
                )
            } else if let place = selectedPlace {
                // Selecting a place (search result or map long-press) takes
                // over the sheet's content — this used to float over the
                // map, where the sheet itself could end up covering it;
                // living inside the sheet, it never can.
                PlaceCard(
                    place: place,
                    onTeleport: placeActions.onTeleport,
                    onRoute: placeActions.onRoute,
                    onAddStop: placeActions.onAddStop,
                    onFavorite: placeActions.onFavorite,
                    onDismiss: placeActions.onDismiss
                )
            } else {
                // Favorites stay visible like Plans' "Maison"/"Travail" row,
                // regardless of what's below — they're quick-access, not content.
                if !isSearching && !favorites.isEmpty {
                    FavoriteChips(favorites: favorites, onSelect: onSelectFavorite, onDelete: onDeleteFavorite)
                }

                if isSearching {
                    searchResultsSection
                } else if !itineraryStops.isEmpty {
                    ItineraryPanel(
                        stops: $itineraryStops,
                        speed: $itinerarySpeed,
                        profile: $itineraryProfile,
                        legEstimates: legEstimates,
                        onAddStop: onAddStop,
                        onLaunch: onLaunchItinerary,
                        onCancel: { itineraryStops = [] }
                    )
                } else {
                    if hasSavedItinerary {
                        Button(action: onLoadLastItinerary) {
                            HStack {
                                Image(systemName: "arrow.uturn.backward.circle.fill")
                                Text("Charger le dernier itinéraire")
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.glass)
                        .padding(.horizontal, 16)
                    }
                    // Patrol entry, promoted out of Réglages so it's reachable
                    // from the map's resting state instead of buried in a form.
                    if !patrol.isActive {
                        Button(action: patrol.onBegin) {
                            HStack {
                                Image(systemName: "shield.lefthalf.filled")
                                Text("Lancer une patrouille")
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.glass)
                        .padding(.horizontal, 16)
                    }
                    if favorites.isEmpty {
                        ContentUnavailableView(
                            "Aucun itinéraire",
                            systemImage: "map",
                            description: Text("Recherchez une adresse ou touchez la carte pour commencer.")
                        )
                        .padding(.top, 8)
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

    /// A single, self-contained glass capsule — search field plus the one
    /// contextual trailing control, with margin on every side instead of
    /// bleeding edge-to-edge. No manual shadow: the glass material already
    /// carries its own elevation (§3.1 of docs/UI_UX_BASELINE.md).
    private var header: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)

            TextField("Rechercher une adresse", text: $searchQuery)
                .focused(isFocused)
                .submitLabel(.search)

            trailingButton
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .glassEffect(.regular.interactive(), in: .capsule)
        .padding(.horizontal, 16)
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
                .font(action == .settings ? .body.weight(.semibold) : .title3)
                .foregroundStyle(.secondary)
                .frame(width: 32, height: 32)
                .contentShape(Circle())
                .contentTransition(.symbolEffect(.replace))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(action == .settings ? "Réglages" : "Annuler")
        .animation(.snappy(duration: 0.2), value: action)
    }

    private var simulationControlBar: some View {
        HStack(spacing: 10) {
            Text(simulationState == "paused" ? "Simulation en pause" : "Simulation en cours")
                .font(.subheadline.weight(.medium))
            Spacer()
            if simulationState == "paused" {
                Button(action: onResumeRoute) {
                    Label("Reprendre", systemImage: "play.fill")
                        .labelStyle(.iconOnly)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.glassProminent)
                .tint(.accentColor)
                .buttonBorderShape(.circle)
            } else {
                Button(action: onPauseRoute) {
                    Label("Mettre en pause", systemImage: "pause.fill")
                        .labelStyle(.iconOnly)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
            }
            Button(action: onStopRoute) {
                Label("Arrêter", systemImage: "stop.fill")
                    .labelStyle(.iconOnly)
                    .foregroundStyle(.red)
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .adaptiveGlassEffect(in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .padding(.horizontal, 16)
    }

    private var patrolActiveBar: some View {
        HStack(spacing: 10) {
            Image(systemName: "shield.lefthalf.filled")
                .foregroundStyle(Color.accentColor)
            Text("Patrouille active")
                .font(.subheadline.weight(.medium))
            Spacer()
            Button(action: patrol.onStop) {
                Label("Arrêter la patrouille", systemImage: "stop.fill")
                    .labelStyle(.iconOnly)
                    .foregroundStyle(.red)
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .adaptiveGlassEffect(in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .padding(.horizontal, 16)
    }

    @ViewBuilder
    private var searchResultsSection: some View {
        if searchSuggestions.isEmpty {
            Text("Recherche...")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .padding(.top, 8)
        } else {
            VStack(spacing: 0) {
                ForEach(Array(searchSuggestions.enumerated()), id: \.offset) { index, completion in
                    Button {
                        onSelectSuggestion(completion)
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "mappin.circle.fill")
                                .foregroundStyle(Color.accentColor)
                                .frame(width: 28)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(completion.title).foregroundStyle(.primary)
                                if !completion.subtitle.isEmpty {
                                    Text(completion.subtitle).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                        }
                        .padding(.vertical, 8)
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    if index < searchSuggestions.count - 1 {
                        Divider()
                    }
                }
            }
            .padding(.horizontal, 16)
        }
    }
}
