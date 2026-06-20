import SwiftUI

/// Connection settings, moved out of the main map screen behind a gear icon
/// so the primary UI stays just the map + omnibar.
struct SettingsSheet: View {
    @Binding var engineAddress: String
    @ObservedObject var engine: EngineClient
    @ObservedObject var discovery: EngineDiscovery
    var onToggleConnection: () -> Void
    var onRetryDiscovery: () -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section("Découverte automatique") {
                    discoveryRow
                }

                Section("Moteur GPS-Mock") {
                    TextField("IP:port", text: $engineAddress)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)

                    HStack {
                        Text("État")
                        Spacer()
                        Text(engine.state.rawValue)
                            .foregroundStyle(engine.state == .connected ? .green : .secondary)
                    }

                    if let drift = engine.status?.lastRealLocation?.drift {
                        HStack {
                            Text("Dérive (bouclier anti-dérive)")
                            Spacer()
                            Text("\(Int(drift)) m")
                                .foregroundStyle(drift > 100 ? .orange : .green)
                        }
                    }

                    if let error = engine.lastError {
                        Text(error).font(.caption).foregroundStyle(.red)
                    }

                    Button(engine.state == .connected || engine.state == .connecting ? "Déconnecter" : "Connecter") {
                        onToggleConnection()
                    }
                }

                Section {
                    Text("La position réelle est envoyée toutes les 10s pour le bouclier anti-dérive du moteur.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Réglages")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Fermer") { dismiss() }
                }
            }
        }
    }

    @ViewBuilder
    private var discoveryRow: some View {
        switch discovery.state {
        case .idle:
            Text("Inactif").foregroundStyle(.secondary)
        case .searching:
            HStack {
                ProgressView().controlSize(.small)
                Text("Recherche du moteur...")
                    .foregroundStyle(.secondary)
            }
        case .found(let host, let port):
            HStack {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                Text("Trouvé : \(host):\(port)")
            }
        case .notFound:
            HStack {
                Image(systemName: "wifi.exclamationmark").foregroundStyle(.orange)
                Text("Introuvable automatiquement")
                Spacer()
                Button("Réessayer") { onRetryDiscovery() }
            }
        }
    }
}
