import SwiftUI
import MapKit

struct BottomSheetSearchResultsView: View {
    let searchSuggestions: [MKLocalSearchCompletion]
    var onSelectSuggestion: (MKLocalSearchCompletion) -> Void

    var body: some View {
        if searchSuggestions.isEmpty {
            Text("Recherche...")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .padding(.top, 8)
        } else {
            VStack(spacing: 0) {
                ForEach(searchSuggestions, id: \.compositeID) { completion in
                    searchResultRow(completion)
                    if completion.compositeID != searchSuggestions.last?.compositeID {
                        Divider()
                            .padding(.leading, 58)
                    }
                }
            }
            .adaptiveGlassEffect(in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .padding(.horizontal, 16)
        }
    }

    private func searchResultRow(_ completion: MKLocalSearchCompletion) -> some View {
        Button {
            onSelectSuggestion(completion)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "mappin.and.ellipse")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.accentColor)
                    .frame(width: 34, height: 34)
                    .background(Color(.secondarySystemFill), in: Circle())

                VStack(alignment: .leading, spacing: 3) {
                    Text(completion.title)
                        .font(.body.weight(.medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)

                    if !completion.subtitle.isEmpty {
                        Text(completion.subtitle)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }

                Spacer(minLength: 8)

                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(minHeight: 58)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

private extension MKLocalSearchCompletion {
    var compositeID: String { "\(title)|\(subtitle)" }
}
