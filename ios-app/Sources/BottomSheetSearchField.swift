import SwiftUI

struct BottomSheetSearchField: View {
    @Binding var searchQuery: String
    var isFocused: FocusState<Bool>.Binding
    let hasItineraryStops: Bool
    var onSubmit: () -> Void = {}

    var body: some View {
        HStack(spacing: 9) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
                .font(.title3.weight(.semibold))
                .accessibilityHidden(true)

            TextField(hasItineraryStops ? "Ajouter un arrêt..." : "Rechercher une adresse", text: $searchQuery)
                .focused(isFocused)
                .submitLabel(.search)
                .onSubmit(onSubmit)
                .font(.title3.weight(.semibold))

            // A clear button when there's text — not a mic, which promised
            // dictation the field never actually did (the keyboard already
            // offers its own dictation mic). Keeps the field focused so the
            // user can immediately retype.
            if !searchQuery.isEmpty {
                Button(action: clearSearch) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 44, height: 44)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Effacer la recherche")
                .transition(.opacity)
            }
        }
        .padding(.leading, 20)
        .padding(.trailing, searchQuery.isEmpty ? 20 : 8)
        .frame(minHeight: 58)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular.interactive(), in: .capsule)
        .animation(.snappy(duration: 0.18), value: searchQuery.isEmpty)
    }

    private func clearSearch() {
        searchQuery = ""
        isFocused.wrappedValue = true
    }
}
