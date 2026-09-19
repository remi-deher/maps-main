import SwiftUI

struct BottomSheetHomeView: View {
    let favorites: [Favorite]
    let recentPlaces: [RecentPlace]
    let hasSavedItinerary: Bool
    let patrol: PatrolControls
    let gpx: GpxImport
    var onSelectFavorite: (Favorite) -> Void
    var onDeleteFavorite: (Favorite) -> Void
    var onSelectRecentPlace: (RecentPlace) -> Void
    var onDeleteRecentPlace: (RecentPlace) -> Void
    var onClearRecentPlaces: () -> Void
    var onLoadLastItinerary: () -> Void
    var onOpenSettings: () -> Void
    var onReportProblem: () -> Void
    @Binding var searchQuery: String
    var isFocused: FocusState<Bool>.Binding

    // Icon/row metrics that scale with Dynamic Type (§ audit #21), so the
    // layout grows with the user's text-size setting instead of staying fixed.
    @ScaledMetric(relativeTo: .body) private var rowIconSize: CGFloat = 34
    @ScaledMetric(relativeTo: .body) private var rowMinHeight: CGFloat = 58
    @ScaledMetric(relativeTo: .caption) private var shortcutIconSize: CGFloat = 64
    @ScaledMetric(relativeTo: .caption) private var favoriteChipSize: CGFloat = 56

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            // Les favoris d'abord, comme Plans : l'usage nominal est « aller à
            // un lieu connu », pas « importer un GPX » (audit P2-2).
            favoritesSection
            quickActionsSection
            if hasSavedItinerary {
                lastItinerarySection
            }
            RecentPlacesSection(
                recentPlaces: recentPlaces,
                limit: 5,
                onSelect: onSelectRecentPlace,
                onDelete: onDeleteRecentPlace,
                onClear: onClearRecentPlaces
            )
            utilitySection
        }
        .padding(.top, 2)
    }

    // Rangée de pastilles rondes, la silhouette de l'accueil de Plans
    // (Maison · Travail · … · Ajouter) — au lieu d'une liste verticale. Elle
    // reprend le vocabulaire visuel de la rangée d'actions de la fiche lieu, et
    // supprime au passage un géocodage inverse par favori : Plans n'affiche que
    // le nom sur ces pastilles.
    private var favoritesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader("Favoris")

            if favorites.isEmpty {
                emptyFavoritesCard
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 14) {
                        ForEach(favorites) { favorite in
                            favoriteChip(favorite)
                        }
                        addFavoriteChip
                    }
                    .padding(.horizontal, 18)
                    .padding(.bottom, 2)
                }
            }
        }
    }

    private func favoriteChip(_ favorite: Favorite) -> some View {
        let appearance = FavoriteAppearanceStore.shared.appearance(
            latitude: favorite.lat,
            longitude: favorite.lon,
            name: favorite.name
        )
        return Button {
            onSelectFavorite(favorite)
        } label: {
            chipLabel(
                title: favorite.name ?? "Favori",
                systemImage: appearance.symbol,
                foreground: .white,
                background: appearance.color
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(favorite.name ?? "Favori")
        .contextMenu {
            // Personnalisation de l'icône, comme Plans sur ses lieux favoris.
            Menu("Icône") {
                ForEach(FavoriteAppearance.allCases) { choice in
                    Button {
                        FavoriteAppearanceStore.shared.setAppearance(
                            choice,
                            latitude: favorite.lat,
                            longitude: favorite.lon
                        )
                    } label: {
                        Label(choice.label, systemImage: choice.symbol)
                    }
                }
            }
            Button("Supprimer", role: .destructive) {
                onDeleteFavorite(favorite)
            }
        }
    }

    private var addFavoriteChip: some View {
        Button(action: focusSearchForAddition) {
            chipLabel(
                title: "Ajouter",
                systemImage: "plus",
                foreground: Color.accentColor,
                background: Color(.tertiarySystemFill)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Ajouter un favori")
    }

    private func chipLabel(
        title: String,
        systemImage: String,
        foreground: Color,
        background: Color
    ) -> some View {
        VStack(spacing: 6) {
            Image(systemName: systemImage)
                .font(.title3.weight(.semibold))
                .foregroundStyle(foreground)
                .frame(width: favoriteChipSize, height: favoriteChipSize)
                .background(background, in: Circle())

            Text(title)
                .font(.caption)
                .foregroundStyle(.primary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(width: max(76, favoriteChipSize + 20))
        .contentShape(Rectangle())
    }

    private var quickActionsSection: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 18) {
                homeShortcutButton("Parcours GPX", icon: "doc.badge.plus", action: gpx.onPick)
                if !patrol.isActive {
                    homeShortcutButton("Patrouille", icon: "shield.lefthalf.filled", action: patrol.onBegin)
                }
            }
            .padding(.horizontal, 18)
        }
    }

    private var lastItinerarySection: some View {
        groupedActionList {
            utilityRow(
                "Dernier itinéraire",
                subtitle: "Charger l’itinéraire enregistré",
                icon: "clock.arrow.circlepath",
                action: onLoadLastItinerary
            )
        }
        .padding(.horizontal, 16)
    }

    private var utilitySection: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader("Plus")
            groupedActionList {
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
            .padding(.horizontal, 16)
        }
    }

    private func sectionHeader(_ title: String) -> some View {
        HStack {
            Text(title)
                .font(.title3.weight(.semibold))
            Spacer()
        }
        .padding(.horizontal, 16)
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
        .sheetCardBackground(in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .padding(.horizontal, 16)
    }

    private func groupedActionList<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(spacing: 0) {
            content()
        }
        .sheetCardBackground(in: RoundedRectangle(cornerRadius: 22, style: .continuous))
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

    private func focusSearchForAddition() {
        searchQuery = ""
        isFocused.wrappedValue = true
    }

    private func homeShortcutButton(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Color.accentColor)
                    .frame(width: shortcutIconSize, height: shortcutIconSize)
                    .background(Color(.secondarySystemFill), in: Circle())

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
