import SwiftUI
import CoreLocation
import MapKit

/// A point selected on the map or from search — name/subtitle are nil for a
/// raw map tap (no geocoded name available), populated for a search result.
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

/// Floating bottom card (à la Plans) shown when a place is selected, with the
/// same actions previously buried in a confirmationDialog — but visible and
/// dismissible without a system sheet getting in the way.
struct PlaceCard: View {
    let place: SelectedPlace
    var onTeleport: () -> Void
    var onRoute: () -> Void
    var onAddStop: () -> Void
    var onFavorite: () -> Void
    var onDismiss: () -> Void

    @State private var actionFeedback = 0
    /// Look Around coverage for the selected place, fetched lazily. Nil when
    /// the area has no Street-level imagery (oceans, remote spots) — the
    /// preview is simply omitted then, never an error (§2 Plans parity).
    @State private var lookAroundScene: MKLookAroundScene?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(place.title)
                        .font(.headline)
                    if let subtitle = place.subtitle {
                        Text(subtitle)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                Button(action: onDismiss) {
                    Label("Fermer", systemImage: "xmark.circle.fill")
                        .labelStyle(.iconOnly)
                        .foregroundStyle(.secondary)
                        .font(.title3)
                        .frame(width: 44, height: 44)
                }
            }

            if let lookAroundScene {
                LookAroundPreview(initialScene: lookAroundScene)
                    .frame(height: 120)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .accessibilityLabel("Aperçu Look Around de \(place.title)")
            }

            // Horizontally scrollable so four full-width labels never get
            // clipped at large Dynamic Type sizes (e.g. iPhone SE under AX
            // text sizes) — matches Plans' own action row behavior.
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    actionButton("Téléporter", icon: "location.fill", action: onTeleport)
                    actionButton("Itinéraire", icon: "arrow.triangle.turn.up.right.diamond.fill", action: onRoute)
                    actionButton("Étape", icon: "plus.circle.fill", action: onAddStop)
                    actionButton("Favori", icon: "star.fill", action: onFavorite)
                }
            }
        }
        .padding(18)
        .adaptiveGlassEffect(in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .padding(.horizontal, 16)
        .sensoryFeedback(.success, trigger: actionFeedback)
        // Re-fetch whenever the selected coordinate changes. Keyed on a
        // lat,lon string because CLLocationCoordinate2D isn't Hashable.
        .task(id: "\(place.coordinate.latitude),\(place.coordinate.longitude)") {
            lookAroundScene = try? await MKLookAroundSceneRequest(coordinate: place.coordinate).scene
        }
    }

    @ViewBuilder
    private func actionButton(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button {
            actionFeedback += 1
            action()
        } label: {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.headline)
                Text(title)
                    .font(.caption)
            }
            .frame(minWidth: 72, minHeight: 44)
            .padding(.vertical, 8)
        }
        .buttonStyle(.glassProminent)
        .tint(.accentColor)
    }
}
