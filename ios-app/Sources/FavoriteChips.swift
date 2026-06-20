import SwiftUI

/// Horizontal row of pill-shaped favorites under the omnibar — like Plans'
/// "Maison"/"Travail" quick-access chips. Each chip is its own glass capsule
/// rather than rows in a card, to match that look. Long-press to delete.
struct FavoriteChips: View {
    let favorites: [Favorite]
    var onSelect: (Favorite) -> Void
    var onDelete: (Favorite) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(favorites) { fav in
                    Button {
                        onSelect(fav)
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "star.fill")
                            Text(fav.name ?? "Favori")
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                    }
                    .buttonStyle(.glass)
                    .contextMenu {
                        Button("Supprimer", role: .destructive) {
                            onDelete(fav)
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
        }
    }
}
