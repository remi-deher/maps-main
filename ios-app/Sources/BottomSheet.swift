import SwiftUI
import MapKit

/// Persistent draggable bottom sheet (à la Plans): collapsed it only shows
/// the search field, dragging the slider up reveals search results, the
/// itinerary being built, or favorites — instead of floating cards over the
/// map. Settings (connection address/state/drift/discovery) are one more
/// sheet away behind the gear icon.
struct BottomSheet: View {
    @Binding var searchQuery: String
    var isFocused: FocusState<Bool>.Binding
    let searchResults: [MKMapItem]
    var onSelectResult: (MKMapItem) -> Void

    @Binding var itineraryStops: [RouteStop]
    @Binding var itinerarySpeed: Double
    @Binding var itineraryProfile: String
    var onAddStop: () -> Void
    var onLaunchItinerary: () -> Void

    let favorites: [Favorite]
    var onSelectFavorite: (Favorite) -> Void
    var onDeleteFavorite: (Favorite) -> Void

    @Binding var engineAddress: String
    @ObservedObject var engine: EngineClient
    @ObservedObject var discovery: EngineDiscovery
    var onToggleConnection: () -> Void
    var onRetryDiscovery: () -> Void

    @State private var showSettings = false

    private var isSearching: Bool {
        !searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(spacing: 14) {
            header

            ScrollView {
                VStack(spacing: 12) {
                    if isSearching {
                        searchResultsSection
                    } else if !itineraryStops.isEmpty {
                        ItineraryPanel(
                            stops: $itineraryStops,
                            speed: $itinerarySpeed,
                            profile: $itineraryProfile,
                            onAddStop: onAddStop,
                            onLaunch: onLaunchItinerary,
                            onCancel: { itineraryStops = [] }
                        )
                    } else if !favorites.isEmpty {
                        FavoriteChips(favorites: favorites, onSelect: onSelectFavorite, onDelete: onDeleteFavorite)
                    } else {
                        ContentUnavailableView(
                            "Aucun itinéraire",
                            systemImage: "map",
                            description: Text("Recherchez une adresse ou touchez la carte pour commencer.")
                        )
                        .padding(.top, 8)
                    }
                }
                .padding(.bottom, 24)
            }
        }
        .padding(.top, 8)
        .sheet(isPresented: $showSettings) {
            SettingsSheet(
                engineAddress: $engineAddress,
                engine: engine,
                discovery: discovery,
                onToggleConnection: onToggleConnection,
                onRetryDiscovery: onRetryDiscovery
            )
        }
    }

    private var header: some View {
        // Sibling glass elements grouped in one GlassEffectContainer for
        // shared rendering/blending — see .claude/skills/swiftui-liquid-glass.
        GlassEffectContainer(spacing: 12) {
        HStack(spacing: 12) {
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

            Button {
                showSettings = true
            } label: {
                Image(systemName: "gearshape.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .frame(width: 42, height: 42)
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
            .clipShape(Circle())
        }
        }
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
