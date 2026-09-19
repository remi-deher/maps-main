import SwiftUI

// Écran de première ouverture, en carte dans la sheet.
//
// Au premier lancement, l'app demandait d'un coup la localisation, les
// notifications et le réseau local : trois alertes système empilées, sans un
// mot d'explication. Or le maintien en arrière-plan exige l'autorisation
// « Toujours » — un refus initial condamne la fonction principale.
// La HIG demande d'expliquer avant de demander : c'est le rôle de cette carte,
// qui ne déclenche la première alerte qu'au tap sur « Continuer ».
// Voir docs/UI_UX_AUDIT_IOS_2026-09.md, P2-5.
struct FirstRunPrimerCard: View {
    var onContinue: () -> Void

    @ScaledMetric(relativeTo: .body) private var iconSize: CGFloat = 32

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Avant de commencer")
                    .font(.title3.weight(.bold))
                Text("iOS va demander trois autorisations. Voici à quoi elles servent.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            VStack(alignment: .leading, spacing: 12) {
                permissionRow(
                    icon: "location.fill",
                    title: "Position",
                    detail: "Compare la position réelle du téléphone à la position simulée "
                        + "(bouclier anti-dérive). Choisissez « Toujours » pour que le "
                        + "maintien en arrière-plan fonctionne."
                )
                permissionRow(
                    icon: "wifi",
                    title: "Réseau local",
                    detail: "Trouve automatiquement le moteur GPS-Mock sur votre Wi-Fi, "
                        + "sans saisir d'adresse IP."
                )
                permissionRow(
                    icon: "bell.fill",
                    title: "Notifications",
                    detail: "Prévient à l'arrivée d'un itinéraire et si la liaison avec "
                        + "le moteur est perdue. Désactivable dans Réglages."
                )
            }

            Button(action: onContinue) {
                Text("Continuer")
                    .font(.headline)
                    .frame(maxWidth: .infinity, minHeight: 48)
            }
            .buttonStyle(.borderedProminent)
            .tint(.accentColor)
            .buttonBorderShape(.capsule)

            Text("Aucune de ces données ne quitte votre réseau local.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .center)
        }
        .padding(18)
        .sheetCardBackground(in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .padding(.horizontal, 16)
    }

    private func permissionRow(icon: String, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.accentColor)
                .frame(width: iconSize, height: iconSize)
                .background(Color(.tertiarySystemFill), in: Circle())
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}
