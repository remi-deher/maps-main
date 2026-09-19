import SwiftUI

// État du moteur, rendu visible sur l'écran principal.
//
// Avant, rien de tout ça n'atteignait la carte : l'état de connexion vivait
// uniquement dans Réglages → Connexion, et une action lancée moteur coupé
// faisait un `return` muet (cf. docs/UI_UX_AUDIT_IOS_2026-09.md, P0-4 et P2-7).
// Plans affiche un bandeau en tête de sheet dès que quelque chose empêche
// l'app de fonctionner — c'est le même rôle ici, plus l'affichage permanent
// « une position est injectée », qui est la promesse centrale du produit.
struct BottomSheetStatusContext {
    let connectionState: EngineConnectionState
    let lastError: String?
    let injectedLocation: LocationStamp?
    let driftMeters: Double?
    // Vrai quand un bandeau de simulation (itinéraire ou patrouille) occupe
    // déjà la place : inutile de répéter « position simulée active ».
    let hasDedicatedSimulationBanner: Bool
    var onConnect: () -> Void
    var onOpenSettings: () -> Void

    var isConnected: Bool { connectionState == .connected }

    var isBusyConnecting: Bool {
        connectionState == .connecting || connectionState == .reconnecting
    }

    // Vrai dès qu'il y a quelque chose à signaler — sert aussi à décider si le
    // bouton rond du header collapsed doit porter une pastille.
    var needsAttention: Bool { !isConnected }
}

struct BottomSheetStatusBannerView: View {
    let status: BottomSheetStatusContext

    @ScaledMetric(relativeTo: .body) private var iconSize: CGFloat = 34

    var body: some View {
        if !status.isConnected {
            connectionBanner
        } else if !status.hasDedicatedSimulationBanner, let injected = status.injectedLocation {
            injectedBanner(injected)
        }
    }

    private var connectionBanner: some View {
        HStack(spacing: 12) {
            Group {
                if status.isBusyConnecting {
                    ProgressView()
                } else {
                    Image(systemName: "antenna.radiowaves.left.and.right.slash")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.orange)
                }
            }
            .frame(width: iconSize, height: iconSize)
            .background(Color(.tertiarySystemFill), in: Circle())

            VStack(alignment: .leading, spacing: 2) {
                Text(status.isBusyConnecting ? "Connexion au moteur…" : "Moteur non connecté")
                    .font(.subheadline.weight(.semibold))
                Text(connectionDetail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }

            Spacer(minLength: 8)

            if !status.isBusyConnecting {
                Button(action: status.onConnect) {
                    Text("Connecter")
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 6)
                        .frame(minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .tint(.accentColor)
                .buttonBorderShape(.capsule)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .padding(.horizontal, 16)
        .accessibilityElement(children: .combine)
    }

    private var connectionDetail: String {
        if let error = status.lastError, !error.isEmpty {
            return error
        }
        if status.isBusyConnecting {
            return "Recherche du moteur sur le réseau local…"
        }
        return "Téléportation, itinéraire et favoris nécessitent le moteur."
    }

    private func injectedBanner(_ injected: LocationStamp) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "location.fill.viewfinder")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.accentColor)
                .frame(width: iconSize, height: iconSize)
                .background(Color(.tertiarySystemFill), in: Circle())

            VStack(alignment: .leading, spacing: 2) {
                Text("Position simulée active")
                    .font(.subheadline.weight(.semibold))
                Text(injectedDetail(injected))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            if let drift = status.driftMeters {
                Text("\(Int(drift)) m")
                    .font(.caption.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(drift > 100 ? .orange : .secondary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Color(.tertiarySystemFill), in: Capsule())
                    .accessibilityLabel("Dérive \(Int(drift)) mètres")
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .padding(.horizontal, 16)
        .accessibilityElement(children: .combine)
    }

    private func injectedDetail(_ injected: LocationStamp) -> String {
        if let name = injected.name, !name.isEmpty {
            return name
        }
        return String(format: "%.5f, %.5f", injected.lat, injected.lon)
    }
}
