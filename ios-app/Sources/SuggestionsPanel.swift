import SwiftUI
import MapKit

/// Floating glass card under the omnibar, showing live search results while
/// typing. Favorites have their own pill row (FavoriteChips) shown instead
/// when the search field is empty.
struct SuggestionsPanel: View {
    let searchResults: [MKMapItem]
    var onSelectResult: (MKMapItem) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
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
        }
        .padding(.vertical, 4)
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .padding(.horizontal, 16)
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
