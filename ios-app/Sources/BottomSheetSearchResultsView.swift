import SwiftUI
import MapKit

struct BottomSheetSearchResultsView: View {
    let searchSuggestions: [MKLocalSearchCompletion]
    let isSearching: Bool
    let query: String
    var onSelectSuggestion: (MKLocalSearchCompletion) -> Void

    // Scale the row icon/height with Dynamic Type (§ audit #21).
    @ScaledMetric(relativeTo: .body) private var rowIconSize: CGFloat = 34
    @ScaledMetric(relativeTo: .body) private var rowMinHeight: CGFloat = 58

    var body: some View {
        if searchSuggestions.isEmpty {
            if isSearching {
                // Still fetching — a spinner, not a premature "no results".
                HStack(spacing: 10) {
                    ProgressView()
                    Text("Recherche…")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.top, 16)
            } else {
                // Genuinely empty result set for the typed query.
                ContentUnavailableView.search(text: query)
                    .padding(.top, 8)
            }
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
                Image(systemName: icon(for: completion))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.accentColor)
                    .frame(width: rowIconSize, height: rowIconSize)
                    .background(Color(.secondarySystemFill), in: Circle())

                VStack(alignment: .leading, spacing: 3) {
                    Text(highlighted(completion.title, ranges: completion.titleHighlightRanges))
                        .font(.body)
                        .foregroundStyle(.primary)
                        .lineLimit(1)

                    if !completion.subtitle.isEmpty {
                        Text(highlighted(completion.subtitle, ranges: completion.subtitleHighlightRanges))
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
            .frame(minHeight: rowMinHeight)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // Bolds the substrings the user actually typed, using the ranges MapKit
    // reports — the same emphasis Plans applies to matched query fragments.
    private func highlighted(_ text: String, ranges: [NSValue]) -> AttributedString {
        var attributed = AttributedString(text)
        let count = attributed.characters.count
        for value in ranges {
            let nsRange = value.rangeValue
            guard nsRange.location != NSNotFound,
                  nsRange.location >= 0,
                  nsRange.length > 0,
                  nsRange.location + nsRange.length <= count else { continue }
            let start = attributed.index(attributed.startIndex, offsetByCharacters: nsRange.location)
            let end = attributed.index(start, offsetByCharacters: nsRange.length)
            attributed[start..<end].font = .body.weight(.semibold)
        }
        return attributed
    }

    // A category/query completion (e.g. "Restaurants") has no located address
    // subtitle — show a search glass; concrete places get a pin.
    private func icon(for completion: MKLocalSearchCompletion) -> String {
        completion.subtitle.isEmpty ? "magnifyingglass" : "mappin.and.ellipse"
    }
}

private extension MKLocalSearchCompletion {
    var compositeID: String { "\(title)|\(subtitle)" }
}
