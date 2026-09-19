import SwiftUI
import CoreLocation

private let resultDistanceFormatter: MeasurementFormatter = {
    let formatter = MeasurementFormatter()
    formatter.unitOptions = .naturalScale
    formatter.unitStyle = .medium
    return formatter
}()

// Liste des résultats d'une recherche plein texte, comme Plans l'affiche dans
// sa sheet : nom, catégorie et distance par ligne, épingles correspondantes sur
// la carte, et on choisit.
//
// Avant, soumettre « restaurants » posait douze épingles, sélectionnait
// d'office la première et ouvrait sa fiche : on ne voyait jamais les résultats
// ensemble, seulement l'un après l'autre via le pager de la fiche.
//
// La distance est calculable ici — contrairement aux suggestions du completer,
// où `MKLocalSearchCompletion` ne porte aucune coordonnée — parce que ces
// résultats viennent d'un `MKLocalSearch` résolu.
struct SearchResultsListView: View {
    let results: [SelectedPlace]
    // Origine des distances : position simulée si elle existe, sinon position
    // réelle. nil masque simplement la colonne.
    let referenceCoordinate: CLLocationCoordinate2D?
    var onSelect: (SelectedPlace) -> Void

    @ScaledMetric(relativeTo: .body) private var rowIconSize: CGFloat = 34
    @ScaledMetric(relativeTo: .body) private var rowMinHeight: CGFloat = 58

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Résultats")
                    .font(.title3.weight(.semibold))
                Spacer()
                Text("\(results.count)")
                    .font(.subheadline)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 16)

            VStack(spacing: 0) {
                ForEach(results, id: \.mapID) { result in
                    row(result)
                    if result.mapID != results.last?.mapID {
                        Divider().padding(.leading, 58)
                    }
                }
            }
            .sheetCardBackground(in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .padding(.horizontal, 16)
        }
    }

    private func row(_ result: SelectedPlace) -> some View {
        let appearance = PointOfInterestStyle.appearance(for: result.category)
        return Button {
            onSelect(result)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: appearance.symbol)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                    .frame(width: rowIconSize, height: rowIconSize)
                    .background(appearance.color, in: Circle())

                VStack(alignment: .leading, spacing: 3) {
                    Text(result.title)
                        .font(.body.weight(.medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    if let secondary = secondaryText(result) {
                        Text(secondary)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }

                Spacer(minLength: 8)

                if let distance = distanceText(result) {
                    Text(distance)
                        .font(.caption.weight(.medium))
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }

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
        .accessibilityLabel(accessibilityLabel(result))
    }

    private func secondaryText(_ result: SelectedPlace) -> String? {
        if let category = PointOfInterestStyle.label(for: result.category) {
            return category
        }
        guard let subtitle = result.subtitle, !subtitle.isEmpty else { return nil }
        return subtitle
    }

    private func distanceText(_ result: SelectedPlace) -> String? {
        guard let referenceCoordinate else { return nil }
        let origin = CLLocation(latitude: referenceCoordinate.latitude, longitude: referenceCoordinate.longitude)
        let target = CLLocation(latitude: result.coordinate.latitude, longitude: result.coordinate.longitude)
        let meters = origin.distance(from: target)
        guard meters > 1 else { return nil }
        return resultDistanceFormatter.string(from: Measurement(value: meters, unit: UnitLength.meters))
    }

    private func accessibilityLabel(_ result: SelectedPlace) -> String {
        [result.title, secondaryText(result), distanceText(result).map { "à \($0)" }]
            .compactMap { $0 }
            .joined(separator: ", ")
    }
}
