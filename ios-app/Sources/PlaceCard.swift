import SwiftUI
import CoreLocation
import MapKit

// A point selected on the map or from search — name/subtitle are nil for a
// raw map tap (no geocoded name available), populated for a search result.
struct SelectedPlace: Equatable {
    let coordinate: CLLocationCoordinate2D
    let title: String
    let subtitle: String?

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.coordinate.latitude == rhs.coordinate.latitude
            && lhs.coordinate.longitude == rhs.coordinate.longitude
            && lhs.title == rhs.title
    }
}

// Floating bottom card (à la Plans) shown when a place is selected, with the
// same actions previously buried in a confirmationDialog — but visible and
// dismissible without a system sheet getting in the way.
struct PlaceCard: View {
    let place: SelectedPlace
    let isFavorite: Bool
    var onTeleport: () -> Void
    var onRoute: () -> Void
    var onAddStop: () -> Void
    var onFavorite: () -> Void
    var onCopyCoordinates: () -> Void
    var onDismiss: () -> Void

    @State private var actionFeedback = 0
    // Look Around coverage for the selected place, fetched lazily. Nil when
    // the area has no Street-level imagery (oceans, remote spots) — the
    // preview is simply omitted then, never an error (§2 Plans parity).
    @State private var lookAroundScene: MKLookAroundScene?
    @State private var placemark: CLPlacemark?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            header

            if let lookAroundScene {
                lookAroundPreview(lookAroundScene)
            }

            placeDetailsCard
            contextualActionBar
        }
        .padding(18)
        .adaptiveGlassEffect(in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .padding(.horizontal, 16)
        .sensoryFeedback(.success, trigger: actionFeedback)
        // Re-fetch whenever the selected coordinate changes. Keyed on a
        // lat,lon string because CLLocationCoordinate2D isn't Hashable.
        .task(id: "\(place.coordinate.latitude),\(place.coordinate.longitude)") {
            lookAroundScene = try? await MKLookAroundSceneRequest(coordinate: place.coordinate).scene
            let location = CLLocation(latitude: place.coordinate.latitude, longitude: place.coordinate.longitude)
            let placemarks = try? await CLGeocoder().reverseGeocodeLocation(location)
            placemark = placemarks?.first
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text(place.title)
                    .font(.largeTitle.weight(.bold))
                    .lineLimit(2)
                    .minimumScaleFactor(0.78)

                if let subtitle = place.subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }

            Spacer()

            Button(action: onDismiss) {
                Label("Fermer", systemImage: "xmark.circle.fill")
                    .labelStyle(.iconOnly)
                    .foregroundStyle(.secondary)
                    .font(.title2)
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
        }
    }

    private func lookAroundPreview(_ scene: MKLookAroundScene) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Aperçu Plans")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)

            LookAroundPreview(initialScene: scene)
                .frame(height: 168)
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                .accessibilityLabel("Aperçu Look Around de \(place.title)")
        }
    }

    private var placeDetailsCard: some View {
        VStack(spacing: 0) {
            if let address = addressText {
                detailRow(title: "Adresse", value: address, icon: "mappin.and.ellipse")
                Divider().padding(.leading, 58)
            }

            detailRow(title: "Coordonnées GPS", value: coordinateText, icon: "location.north.line.fill")

            if let locality = localityText {
                Divider().padding(.leading, 58)
                detailRow(title: "Zone", value: locality, icon: "map.fill")
            }
        }
        .adaptiveGlassEffect(in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private var contextualActionBar: some View {
        HStack(spacing: 10) {
            Button {
                if !isFavorite {
                    trigger(onFavorite)
                }
            } label: {
                Label(isFavorite ? "Ajouté aux favoris" : "Favori", systemImage: isFavorite ? "checkmark.circle.fill" : "star.fill")
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: 46)
            }
            .buttonStyle(.glassProminent)
            .tint(.accentColor)
            .disabled(isFavorite)

            Menu {
                Button {
                    trigger(onTeleport)
                } label: {
                    Label("Positionner ici", systemImage: "location.fill")
                }

                Button {
                    trigger(onRoute)
                } label: {
                    Label("Créer un itinéraire", systemImage: "arrow.triangle.turn.up.right.diamond.fill")
                }

                Button {
                    trigger(onAddStop)
                } label: {
                    Label("Ajouter comme étape", systemImage: "plus.circle.fill")
                }

                Button {
                    trigger(onCopyCoordinates)
                } label: {
                    Label("Copier les coordonnées", systemImage: "doc.on.doc.fill")
                }
            } label: {
                Label("Plus d’actions", systemImage: "ellipsis")
                    .labelStyle(.iconOnly)
                    .font(.title3.weight(.semibold))
                    .frame(width: 52, height: 46)
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.capsule)
        }
        .padding(8)
        .adaptiveGlassEffect(in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private func detailRow(title: String, value: String, icon: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.accentColor)
                .frame(width: 34, height: 34)
                .background(Color(.secondarySystemFill), in: Circle())

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.body)
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 11)
    }

    private var addressText: String? {
        let lines = [
            thoroughfareText,
            cityText,
            placemark?.country
        ]
        .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }

        if !lines.isEmpty {
            return lines.joined(separator: "\n")
        }

        if let subtitle = place.subtitle, !subtitle.isEmpty {
            return subtitle
        }

        return nil
    }

    private var thoroughfareText: String? {
        guard let placemark else { return nil }
        let parts = [placemark.subThoroughfare, placemark.thoroughfare]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " ")
    }

    private var cityText: String? {
        guard let placemark else { return nil }
        let parts = [placemark.postalCode, placemark.locality]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
        return parts.isEmpty ? placemark.administrativeArea : parts.joined(separator: " ")
    }

    private var localityText: String? {
        let parts = [placemark?.subLocality, placemark?.administrativeArea]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: ", ")
    }

    private var coordinateText: String {
        String(format: "%.6f, %.6f", place.coordinate.latitude, place.coordinate.longitude)
    }

    private func trigger(_ action: () -> Void) {
        actionFeedback += 1
        action()
    }
}
