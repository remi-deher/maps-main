import SwiftUI
import MapKit

extension BottomSheet {
    var expandedHomeContent: some View {
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

    var quickActionsSection: some View {
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

    var placesSection: some View {
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

    var recentsSection: some View {
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

    var guidesSection: some View {
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

    var utilitySection: some View {
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

    var visibleFavorites: [Favorite] {
        favorites
    }

    func focusSearchForAddition() {
        searchQuery = ""
        isFocused.wrappedValue = true
    }

    func homeShortcutButton(_ title: String, icon: String, isPrimary: Bool = false, action: @escaping () -> Void) -> some View {
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
