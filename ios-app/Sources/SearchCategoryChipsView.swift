import SwiftUI

// Puces de catégories sous le champ de recherche, comme Plans les propose dès
// qu'on touche le champ : « Restaurants », « Stations-service », « Parkings »…
//
// Pour un outil de simulation c'est plus qu'un ornement — chercher « stations
// service » est exactement la façon dont on trouve un point plausible où se
// téléporter, sans connaître d'adresse. Chaque puce lance la même recherche
// plein texte que la touche « Rechercher » du clavier.
// Voir docs/UI_UX_AUDIT_IOS_2026-09.md.
struct SearchCategoryChipsView: View {
    var onSelect: (String) -> Void

    private struct Category: Identifiable {
        let id = UUID()
        let label: String
        let symbol: String
        let color: Color
        // Requête envoyée à MKLocalSearch — parfois plus explicite que le
        // libellé affiché (« essence » rapporte moins que « station-service »).
        var query: String { label }
    }

    private let categories: [Category] = [
        Category(label: "Restaurants", symbol: "fork.knife", color: .orange),
        Category(label: "Cafés", symbol: "cup.and.saucer.fill", color: .orange),
        Category(label: "Stations-service", symbol: "fuelpump.fill", color: .blue),
        Category(label: "Parkings", symbol: "parkingsign", color: .blue),
        Category(label: "Supermarchés", symbol: "cart.fill", color: .yellow),
        Category(label: "Hôtels", symbol: "bed.double.fill", color: .purple),
        Category(label: "Pharmacies", symbol: "cross.case.fill", color: .red),
        Category(label: "Parcs", symbol: "tree.fill", color: .green),
        Category(label: "Gares", symbol: "tram.fill", color: .blue)
    ]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(categories) { category in
                    chip(category)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 2)
        }
    }

    private func chip(_ category: Category) -> some View {
        Button {
            onSelect(category.query)
        } label: {
            HStack(spacing: 6) {
                Image(systemName: category.symbol)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(category.color)
                Text(category.label)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 44)
            .background(Color(.secondarySystemGroupedBackground), in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Rechercher : \(category.label)")
    }
}
