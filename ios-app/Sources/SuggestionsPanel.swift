import SwiftUI
import MapKit

/// Floating glass card under the omnibar: search results while typing,
/// favorites as quick suggestions otherwise — mirrors how Plans shows
/// recents/favorites the moment you tap the (empty) search field.
struct SuggestionsPanel: View {
    let favorites: [Favorite]
    let searchResults: [MKMapItem]
    let isSearching: Bool
    var onSelectFavorite: (Favorite) -> Void
    var onSelectResult: (MKMapItem) -> Void
    var onDeleteFavorite: (Favorite) -> Void

    var body: some View {
        if shouldShow {
            VStack(alignment: .leading, spacing: 0) {
                if isSearching {
                    if searchResults.isEmpty {
                        Text("Recherche...")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .padding(14)
                    } else {
                        ForEach(Array(searchResults.enumerated()), id: \.offset) { index, item in
                            Button {
                                onSelectResult(item)
                            } label: {
                                row(title: item.name ?? "Lieu", subtitle: item.placemark.title, icon: "mappin.circle.fill")
                            }
                            if index < searchResults.count - 1 {
                                Divider().padding(.leading, 54)
                            }
                        }
                    }
                } else {
                    ForEach(Array(favorites.enumerated()), id: \.element.id) { index, fav in
                        HStack(spacing: 4) {
                            Button {
                                onSelectFavorite(fav)
                            } label: {
                                row(title: fav.name ?? "Favori", subtitle: nil, icon: "star.fill")
                            }
                            Button {
                                onDeleteFavorite(fav)
                            } label: {
                                Image(systemName: "trash")
                                    .foregroundStyle(.red)
                                    .frame(width: 36, height: 36)
                            }
                            .buttonStyle(.plain)
                            .padding(.trailing, 10)
                        }
                        if index < favorites.count - 1 {
                            Divider().padding(.leading, 54)
                        }
                    }
                }
            }
            .padding(.vertical, 4)
            .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .padding(.horizontal, 16)
        }
    }

    private var shouldShow: Bool {
        isSearching || !favorites.isEmpty
    }

    @ViewBuilder
    private func row(title: String, subtitle: String?, icon: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(.indigo)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).foregroundStyle(.primary)
                if let subtitle {
                    Text(subtitle).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
    }
}
