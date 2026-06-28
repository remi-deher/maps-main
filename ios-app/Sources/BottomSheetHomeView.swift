import SwiftUI
import MapKit

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
    @Binding var searchQuery: String
    var isFocused: FocusState<Bool>.Binding

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            quickActionsSection
            placesSection
            if hasSavedItinerary || !recentPlaces.isEmpty {
                recentsSection
            }
            guidesSection
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

    private var guidesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader("Vos guides")
            guideCard(
                title: "Favoris",
                subtitle: favorites.isEmpty ? "Aucun lieu enregistré" : "\(favorites.count) lieu\(favorites.count > 1 ? "x" : "")",
                icon: "star.fill"
            )
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
                    action: onOpenSettings
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
                    .frame(width: 34, height: 34)
                    .background(Color(.secondarySystemFill), in: Circle())

                VStack(alignment: .leading, spacing: 3) {
                    Text(favorite.name ?? "Favori")
                        .font(.body.weight(.medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    Text(favoriteCoordinates(for: favorite))
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
            .frame(minHeight: 58)
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
                    .frame(width: 34, height: 34)
                    .background(Color(.secondarySystemFill), in: Circle())

                VStack(alignment: .leading, spacing: 3) {
                    Text(recent.title)
                        .font(.body.weight(.medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    Text(recent.subtitle ?? recentCoordinates(for: recent))
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
            .frame(minHeight: 58)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func guideCard(title: String, subtitle: String, icon: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.headline.weight(.semibold))
                .foregroundStyle(Color.accentColor)
                .frame(width: 42, height: 42)
                .background(Color(.secondarySystemFill), in: RoundedRectangle(cornerRadius: 12, style: .continuous))

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.body.weight(.medium))
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 70, alignment: .leading)
        .adaptiveGlassEffect(in: RoundedRectangle(cornerRadius: 20, style: .continuous))
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
                    .frame(width: 34, height: 34)
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
            .frame(minHeight: 58)
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

    private func favoriteCoordinates(for favorite: Favorite) -> String {
        String(format: "%.5f, %.5f", favorite.lat, favorite.lon)
    }

    private func recentCoordinates(for recent: RecentPlace) -> String {
        String(format: "%.5f, %.5f", recent.lat, recent.lon)
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
                    .frame(width: 64, height: 64)
                    .background(isPrimary ? Color.accentColor : Color(.secondarySystemFill), in: Circle())

                Text(title)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.78)
            }
            .frame(width: 82)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
    }
}
