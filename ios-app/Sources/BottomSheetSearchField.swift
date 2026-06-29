import SwiftUI

struct BottomSheetSearchField: View {
    @Binding var searchQuery: String
    var isFocused: FocusState<Bool>.Binding
    let hasItineraryStops: Bool

    var body: some View {
        HStack(spacing: 9) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
                .font(.title3.weight(.semibold))
                .accessibilityHidden(true)

            TextField(hasItineraryStops ? "Ajouter un arrêt..." : "Rechercher une adresse", text: $searchQuery)
                .focused(isFocused)
                .submitLabel(.search)
                .font(.title3.weight(.semibold))

            Button(action: focusSearch) {
                Image(systemName: "mic.fill")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 44, height: 44)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Recherche vocale")
        }
        .padding(.leading, 20)
        .padding(.trailing, 8)
        .frame(minHeight: 58)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular.interactive(), in: .capsule)
    }

    private func focusSearch() {
        isFocused.wrappedValue = true
    }
}
