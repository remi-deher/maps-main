import SwiftUI
import MapKit
import CoreLocation

struct BottomSheetHomeView: View {
    let favorites: [Favorite]
    let recentPlaces: [RecentPlace]
    let hasSavedItinerary: Bool
    let patrol: PatrolControls
    let gpx: GpxImport
    var onSelectFavorite: (Favorite) -> Void
    var onDeleteFavorite: (Favorite) -> Void
    var onSelectRecentPlace: (RecentPlace) -> Void
    var onClearRecentPlaces: () -> Void
    var onLoadLastItinerary: () -> Void
    var onOpenSettings: () -> Void
    var onReportProblem: () -> Void
    @Binding var searchQuery: String
    var isFocused: FocusState<Bool>.Binding

    // Reverse-geocoded addresses keyed by "lat,lon", so favorite/recent rows
    // show a human address instead of raw coordinates (§ audit #10). Resolved
    // lazily per row and cached for the lifetime of the view.
    @State private var resolvedAddresses: [String: String] = [:]

    // Icon/row metrics that scale with Dynamic Type (§ audit #21), so the
    // layout grows with the user's text-size setting instead of staying fixed.
    @ScaledMetric(relativeTo: .body) private var rowIconSize: CGFloat = 34
    @ScaledMetric(relativeTo: .body) private var rowMinHeight: CGFloat = 58
    @ScaledMetric(relativeTo: .caption) private var shortcutIconSize: CGFloat = 64

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            quickActionsSection
            placesSection
            if hasSavedItinerary || !recentPlaces.isEmpty {
                recentsSection
            }
            utilitySection
        }
        .padding(.top, 2)
    }

    private var quickActionsSection: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 18) {
                homeShortcutButton("Parcours GPX", icon: "doc.badge.plus", isPrimary: true, action: gpx.onPick)
                if !patrol.isActive {
                    homeShortcutButton("Patrouille", icon: "shield.lefthalf.filled", action: patrol.onBegin)
                }
                homeShortcutButton("Ajouter", icon: "plus", action: focusSearchForAddition)
            }
            .padding(.horizontal, 18)
        }
    }

    private var placesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader("Lieux") {
                Button(action: focusSearchForAddition) {
                    Label("Ajouter un lieu", systemImage: "plus.circle.fill")
                        .labelStyle(.iconOnly)
                        .font(.title3.weight(.semibold))
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color.accentColor)
            }

            if favorites.isEmpty {
                emptyFavoritesCard
            } else {
                favoriteListCard
            }
        }
        .padding(.horizontal, 16)
    }

    private var recentsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader("Récents") {
                if !recentPlaces.isEmpty {
                    Button("Effacer", action: onClearRecentPlaces)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Color.accentColor)
                }
            }
            groupedActionList {
                if hasSavedItinerary {
                    utilityRow(
                        "Dernier itinéraire",
                        subtitle: "Charger l’itinéraire enregistré",
                        icon: "clock.arrow.circlepath",
                        action: onLoadLastItinerary
                    )
                    if !recentPlaces.isEmpty {
                        Divider().padding(.leading, 58)
                    }
                }

                ForEach(recentPlaces.prefix(5)) { recent in
                    recentPlaceRow(recent)
                    if recent.id != recentPlaces.prefix(5).last?.id {
                        Divider().padding(.leading, 58)
                    }
                }
            }
        }
        .padding(.horizontal, 16)
    }

    private var utilitySection: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader("Plus")
            groupedActionList {
                utilityRow(
                    "Rechercher ou ajouter un lieu",
                    subtitle: "Créer un favori depuis la recherche",
                    icon: "mappin.and.ellipse",
                    action: focusSearchForAddition
                )
                Divider().padding(.leading, 58)
                utilityRow(
                    "Réglages de connexion",
                    subtitle: "Connexion, appareil et préférences",
                    icon: "gearshape.fill",
                    action: onOpenSettings
                )
                Divider().padding(.leading, 58)
                utilityRow(
                    "Signaler un problème",
                    subtitle: "Ouvrir les diagnostics de l’app",
                    icon: "exclamationmark.bubble.fill",
                    action: onReportProblem
                )
            }
        }
        .padding(.horizontal, 16)
    }

    private func sectionHeader(_ title: String) -> some View {
        HStack {
            Text(title)
                .font(.title3.weight(.semibold))
            Spacer()
        }
    }

    private func sectionHeader<Trailing: View>(_ title: String, @ViewBuilder trailing: () -> Trailing) -> some View {
        HStack {
            Text(title)
                .font(.title3.weight(.semibold))
            Spacer()
            trailing()
        }
    }

    private var emptyFavoritesCard: some View {
        Button(action: focusSearchForAddition) {
            HStack(spacing: 12) {
                Image(systemName: "star")
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(Color.accentColor)
                    .frame(width: 38, height: 38)
                    .background(Color(.secondarySystemFill), in: Circle())

                VStack(alignment: .leading, spacing: 3) {
                    Text("Aucun favori")
                        .font(.body.weight(.medium))
                        .foregroundStyle(.primary)
                    Text("Recherchez un lieu pour l'ajouter ici.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer()

                Image(systemName: "plus")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.accentColor)
            }
            .padding(14)
            .frame(maxWidth: .infinity, minHeight: 66, alignment: .leading)
            .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
        .buttonStyle(.plain)
        .adaptiveGlassEffect(in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private var favoriteListCard: some View {
        VStack(spacing: 0) {
            ForEach(favorites) { favorite in
                favoriteRow(favorite)
                if favorite.id != favorites.last?.id {
                    Divider()
                        .padding(.leading, 58)
                }
            }
        }
        .adaptiveGlassEffect(in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private func favoriteRow(_ favorite: Favorite) -> some View {
        Button {
            onSelectFavorite(favorite)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: favoriteIcon(for: favorite))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.accentColor)
                    .frame(width: rowIconSize, height: rowIconSize)
                    .background(Color(.secondarySystemFill), in: Circle())

                VStack(alignment: .leading, spacing: 3) {
                    Text(favorite.name ?? "Favori")
                        .font(.body.weight(.medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    resolvedAddressLabel(lat: favorite.lat, lon: favorite.lon)
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
        .contextMenu {
            Button("Supprimer", role: .destructive) {
                onDeleteFavorite(favorite)
            }
        }
    }

    private func recentPlaceRow(_ recent: RecentPlace) -> some View {
        Button {
            onSelectRecentPlace(recent)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "clock.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.accentColor)
                    .frame(width: rowIconSize, height: rowIconSize)
                    .background(Color(.secondarySystemFill), in: Circle())

                VStack(alignment: .leading, spacing: 3) {
                    Text(recent.title)
                        .font(.body.weight(.medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    if let subtitle = recent.subtitle, !subtitle.isEmpty, !looksLikeCoordinates(subtitle) {
                        Text(subtitle)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    } else {
                        resolvedAddressLabel(lat: recent.lat, lon: recent.lon)
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

    private func groupedActionList<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(spacing: 0) {
            content()
        }
        .adaptiveGlassEffect(in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private func utilityRow(_ title: String, subtitle: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.accentColor)
                    .frame(width: rowIconSize, height: rowIconSize)
                    .background(Color(.secondarySystemFill), in: Circle())

                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.body.weight(.medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
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

    private func favoriteIcon(for favorite: Favorite) -> String {
        let name = (favorite.name ?? "").lowercased()
        if ["maison", "domicile", "home"].contains(where: name.contains) {
            return "house.fill"
        }
        if ["travail", "bureau", "work"].contains(where: name.contains) {
            return "briefcase.fill"
        }
        return "star.fill"
    }

    // Shows the reverse-geocoded address for a coordinate, resolving it lazily
    // and caching the result. Before it resolves, a redacted placeholder keeps
    // the row height stable — never raw lat/lon.
    @ViewBuilder
    private func resolvedAddressLabel(lat: Double, lon: Double) -> some View {
        let key = addressKey(lat, lon)
        Group {
            if let address = resolvedAddresses[key] {
                Text(address)
            } else {
                Text("Adresse…")
                    .redacted(reason: .placeholder)
            }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .task(id: key) { await resolveAddress(lat: lat, lon: lon) }
    }

    private func addressKey(_ lat: Double, _ lon: Double) -> String {
        String(format: "%.5f,%.5f", lat, lon)
    }

    private func resolveAddress(lat: Double, lon: Double) async {
        let key = addressKey(lat, lon)
        if resolvedAddresses[key] != nil { return }
        let location = CLLocation(latitude: lat, longitude: lon)
        guard let placemark = try? await CLGeocoder().reverseGeocodeLocation(location).first else { return }
        let parts = [placemark.thoroughfare, placemark.locality].compactMap { $0 }.filter { !$0.isEmpty }
        let address = parts.isEmpty ? (placemark.name ?? "") : parts.joined(separator: ", ")
        if !address.isEmpty {
            resolvedAddresses[key] = address
        }
    }

    // Legacy recents may have stored raw "lat, lon" as their subtitle before
    // #10 — detect that shape so we geocode a real address instead.
    private func looksLikeCoordinates(_ text: String) -> Bool {
        let parts = text.split(separator: ",")
        guard parts.count == 2 else { return false }
        return parts.allSatisfy { Double($0.trimmingCharacters(in: .whitespaces)) != nil }
    }

    private func focusSearchForAddition() {
        searchQuery = ""
        isFocused.wrappedValue = true
    }

    private func homeShortcutButton(_ title: String, icon: String, isPrimary: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(isPrimary ? Color.white : Color.accentColor)
                    .frame(width: shortcutIconSize, height: shortcutIconSize)
                    .background(isPrimary ? Color.accentColor : Color(.secondarySystemFill), in: Circle())

                Text(title)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.78)
            }
            .frame(width: max(82, shortcutIconSize + 18))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
    }
}
