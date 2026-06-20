import SwiftUI
import CoreLocation

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
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                        .font(.system(size: 20))
                }
            }

            HStack(spacing: 10) {
                actionButton("Téléporter", icon: "location.fill", action: onTeleport)
                actionButton("Trajet", icon: "arrow.triangle.turn.up.right.diamond.fill", action: onRoute)
                actionButton("Étape", icon: "plus.circle.fill", action: onAddStop)
                actionButton("Favori", icon: "star.fill", action: onFavorite)
            }
        }
        .padding(18)
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .padding(.horizontal, 16)
        .sensoryFeedback(.success, trigger: actionFeedback)
    }

    @ViewBuilder
    private func actionButton(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button {
            actionFeedback += 1
            action()
        } label: {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 16, weight: .semibold))
                Text(title)
                    .font(.caption2)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
        }
        .buttonStyle(.glassProminent)
        .tint(.indigo)
    }
}
