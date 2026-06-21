import SwiftUI
import MapKit

/// Persistent draggable bottom sheet (à la Plans): collapsed it only shows
/// the search field, dragging the slider up reveals search results, the
/// itinerary being built, or favorites — instead of floating cards over the
/// map. Settings now live in their own floating gear button (ContentView),
/// not bundled into this header — the search field here is search-only,
/// matching Plans' detached, single-purpose search bar.
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
    var onPlaceTeleport: () -> Void
    var onPlaceRoute: () -> Void
    var onPlaceAddStop: () -> Void
    var onPlaceFavorite: () -> Void
    var onPlaceDismiss: () -> Void

    let simulationState: String?
    var onPauseRoute: () -> Void
    var onResumeRoute: () -> Void
    var onStopRoute: () -> Void

    let isEngineConnected: Bool
    var onConnect: () -> Void

    private var isSearching: Bool {
        !searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(spacing: 14) {
            header

            ScrollView {
                VStack(spacing: 12) {
                    // Inline, persistent indicator instead of a modal alert —
                    // a routine "engine not connected" state shouldn't
                    // interrupt with a dialog every time a pilot action is
                    // attempted (HIG: alerts are for important, infrequent
                    // information). See §3.9 of docs/UI_UX_BASELINE.md.
                    if !isEngineConnected {
                        connectionBanner
                    }

                    // Persistent like Plans' "navigation active" banner — visible
                    // regardless of what else is on screen, since pausing/
                    // stopping a running simulation is a system-level action.
                    if simulationState == "moving" || simulationState == "paused" {
                        simulationControlBar
                    }

                    if let place = selectedPlace {
                        // Selecting a place (search result or map long-press)
                        // takes over the sheet's content — this used to float
                        // over the map, where the sheet itself could end up
                        // covering it; living inside the sheet, it never can.
                        PlaceCard(
                            place: place,
                            onTeleport: onPlaceTeleport,
                            onRoute: onPlaceRoute,
                            onAddStop: onPlaceAddStop,
                            onFavorite: onPlaceFavorite,
                            onDismiss: onPlaceDismiss
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
                .padding(.bottom, 24)
            }
        }
        .padding(.top, 8)
    }

    /// A single, self-contained glass capsule — search only, no settings
    /// button riding along, with margin on every side instead of bleeding
    /// edge-to-edge. No manual shadow: the glass material already carries
    /// its own elevation (§3.1 of docs/UI_UX_BASELINE.md).
    private var header: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)

            TextField("Rechercher une adresse", text: $searchQuery)
                .focused(isFocused)
                .submitLabel(.search)

            if !searchQuery.isEmpty {
                Button {
                    searchQuery = ""
                } label: {
                    Label("Effacer la recherche", systemImage: "xmark.circle.fill")
                        .labelStyle(.iconOnly)
                        .foregroundStyle(.secondary)
                        .frame(width: 28, height: 28)
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .glassEffect(.regular.interactive(), in: .capsule)
        .padding(.horizontal, 16)
    }

    private var connectionBanner: some View {
        HStack(spacing: 10) {
            Image(systemName: "wifi.exclamationmark")
                .foregroundStyle(.orange)
            Text("Moteur non connecté")
                .font(.subheadline.weight(.medium))
            Spacer()
            Button("Connecter", action: onConnect)
                .buttonStyle(.glass)
                .frame(minHeight: 44)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .adaptiveGlassEffect(in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .padding(.horizontal, 16)
        .accessibilityElement(children: .combine)
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
                                .foregroundStyle(.accentColor)
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
