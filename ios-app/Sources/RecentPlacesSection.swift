import SwiftUI

// Liste des lieux récents, partagée entre l'accueil de la sheet et le mode
// recherche (champ actif, requête vide) — c'est exactement ce que Plans montre
// dès qu'on touche son champ de recherche.
//
// Extraite de `BottomSheetHomeView` pour éviter d'en avoir deux copies : le
// mode recherche n'affiche plus l'accueil complet (favoris, GPX, patrouille,
// réglages…), seulement les puces de catégories et ces récents.
struct RecentPlacesSection: View {
    let recentPlaces: [RecentPlace]
    // Nombre de lignes affichées : l'accueil en montre quelques-unes, le mode
    // recherche la liste complète, comme Plans.
    var limit: Int
    var showsHeader: Bool = true
    var onSelect: (RecentPlace) -> Void
    var onDelete: (RecentPlace) -> Void
    var onClear: () -> Void

    @ScaledMetric(relativeTo: .body) private var rowIconSize: CGFloat = 34
    @ScaledMetric(relativeTo: .body) private var rowMinHeight: CGFloat = 58

    private var displayed: [RecentPlace] {
        Array(recentPlaces.prefix(limit))
    }

    var body: some View {
        if !displayed.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                if showsHeader {
                    HStack {
                        Text("Récents")
                            .font(.title3.weight(.semibold))
                        Spacer()
                        Button("Effacer", action: onClear)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(Color.accentColor)
                    }
                }

                VStack(spacing: 0) {
                    ForEach(displayed) { recent in
                        row(recent)
                        if recent.id != displayed.last?.id {
                            Divider().padding(.leading, 58)
                        }
                    }
                }
                .sheetCardBackground(in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            }
            .padding(.horizontal, 16)
        }
    }

    private func row(_ recent: RecentPlace) -> some View {
        Button {
            onSelect(recent)
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
                    if let subtitle = recent.subtitle, !subtitle.isEmpty, !Self.looksLikeCoordinates(subtitle) {
                        Text(subtitle)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    } else {
                        ResolvedAddressLabel(latitude: recent.lat, longitude: recent.lon)
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
        // Suppression unitaire : Plans l'offre au balayage, qui exige une
        // `List`. Le panneau héberge aussi des vues non cellulaires (fiche
        // lieu, GPX, patrouille) avec lesquelles une `List` se bat — le menu
        // contextuel rend le même service sans ce refactor, et c'est déjà le
        // geste utilisé pour les favoris.
        .contextMenu {
            Button("Supprimer", role: .destructive) { onDelete(recent) }
        }
        .accessibilityActions {
            Button("Supprimer des récents", role: .destructive) { onDelete(recent) }
        }
    }

    // Legacy recents may have stored raw "lat, lon" as their subtitle — detect
    // that shape so we geocode a real address instead.
    static func looksLikeCoordinates(_ text: String) -> Bool {
        let parts = text.split(separator: ",")
        guard parts.count == 2 else { return false }
        return parts.allSatisfy { Double($0.trimmingCharacters(in: .whitespaces)) != nil }
    }
}

// Adresse géocodée d'un point, résolue paresseusement via le résolveur
// mutualisé (sérialisé, mis en cache, avec repli lisible en cas d'échec — voir
// AddressResolver.swift). Avant résolution, un placeholder masqué garde la
// hauteur de ligne stable ; jamais de lat/lon brut, que Plans n'affiche pas.
struct ResolvedAddressLabel: View {
    let latitude: Double
    let longitude: Double

    var body: some View {
        Group {
            if let address = AddressResolver.shared.address(latitude: latitude, longitude: longitude) {
                Text(address)
            } else {
                Text("Adresse…")
                    .redacted(reason: .placeholder)
            }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .onAppear { AddressResolver.shared.request(latitude: latitude, longitude: longitude) }
    }
}
