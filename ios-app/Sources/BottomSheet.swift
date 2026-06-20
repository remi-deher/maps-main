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
    let searchResults: [MKMapItem]
    var onSelectResult: (MKMapItem) -> Void

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

    private var isSearching: Bool {
        !searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(spacing: 14) {
            header

            ScrollView {
                VStack(spacing: 12) {
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
                .padding(.bottom, 24)
            }
        }
        .padding(.top, 8)
    }

    /// A single, self-contained glass capsule — search only, no settings
    /// button riding along. Its own shadow gives it a floating-card look
    /// distinct from the sheet's translucent backdrop, with margin on every
    /// side instead of bleeding edge-to-edge.
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
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .glassEffect(.regular.interactive(), in: .capsule)
        .shadow(color: .black.opacity(0.12), radius: 10, y: 3)
        .padding(.horizontal, 16)
    }

    @ViewBuilder
    private var searchResultsSection: some View {
        if searchResults.isEmpty {
            Text("Recherche...")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .padding(.top, 8)
        } else {
            VStack(spacing: 0) {
                ForEach(Array(searchResults.enumerated()), id: \.offset) { index, item in
                    Button {
                        onSelectResult(item)
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "mappin.circle.fill")
                                .foregroundStyle(.indigo)
                                .frame(width: 28)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.name ?? "Lieu").foregroundStyle(.primary)
                                if let subtitle = item.placemark.title {
                                    Text(subtitle).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                        }
                        .padding(.vertical, 8)
                        .contentShape(Rectangle())
                    }
                    if index < searchResults.count - 1 {
                        Divider()
                    }
                }
            }
            .padding(.horizontal, 16)
        }
    }
}
