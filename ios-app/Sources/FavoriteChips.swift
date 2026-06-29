import SwiftUI

// Horizontal row of pill-shaped favorites under the omnibar — like Plans'
// "Maison"/"Travail" quick-access chips. Each chip is its own glass capsule
// rather than rows in a card, to match that look. Long-press to delete.
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
                            Image(systemName: icon(for: fav))
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

    // Mirrors Plans' "Maison"/"Travail" iconography by sniffing the
    // favorite's name, falling back to a plain star for everything else.
    private func icon(for favorite: Favorite) -> String {
        let name = (favorite.name ?? "").lowercased()
        let homeKeywords = ["maison", "domicile", "home"]
        if homeKeywords.contains(where: name.contains) {
            return "house.fill"
        }
        let workKeywords = ["travail", "bureau", "work"]
        if workKeywords.contains(where: name.contains) {
            return "briefcase.fill"
        }
        return "star.fill"
    }
}
