import SwiftUI
import CoreLocation

struct DiagnosticsView: View {
    var engine: any EngineClientProtocol
    var discovery: EngineDiscovery

    @State private var isRestartingServices = false
    @State private var showRestartConfirmation = false

    var body: some View {
        List {
            Section("Liaison Moteur") {
                HStack {
                    Text("État connexion")
                    Spacer()
                    Text(engine.state.rawValue)
                        .foregroundStyle(connectionColor)
                }

                if let latency = engine.pingLatency {
                    HStack {
                        Text("Latence (Ping)")
                        Spacer()
                        Text("\(Int(latency)) ms")
                            .foregroundStyle(latencyColor(latency))
                    }
                }

                HStack {
                    Text("Serveur")
                    Spacer()
                    Text(engine.status?.deviceInfo?.name ?? "Moteur inconnu")
                        .foregroundStyle(.secondary)
                }

                HStack {
                    Text("Pilote Actif")
                    Spacer()
                    Text(engine.status?.deviceInfo?.driver ?? "Aucun")
                        .foregroundStyle(.secondary)
                }

                HStack {
                    Text("Type Connexion")
                    Spacer()
                    Text(engine.status?.connectionType ?? "Inconnu")
                        .foregroundStyle(.secondary)
                }
            }

            Section("Bouclier Anti-Dérive") {
                if let target = engine.status?.lastInjectedLocation {
                    HStack {
                        Text("Position simulée")
                        Spacer()
                        Text(String(format: "%.5f, %.5f", target.lat, target.lon))
                            .font(.system(.body, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                }

                if let real = engine.status?.lastRealLocation {
                    HStack {
                        Text("Position réelle")
                        Spacer()
                        Text(String(format: "%.5f, %.5f", real.lat, real.lon))
                            .font(.system(.body, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }

                    if let drift = real.drift {
                        HStack {
                            Text("Dérive détectée")
                            Spacer()
                            Text("\(Int(drift)) m")
                                .foregroundStyle(drift > 100 ? .orange : .green)
                                .fontWeight(.bold)
                        }
                    }
                } else {
                    Text("En attente de la première coordonnée réelle du GPS de l'iPhone...")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Button("Forcer la ré-injection (Relance)") {
                    engine.relance()
                }
                .disabled(engine.state != .connected)
            }

            Section("Découverte automatique (Bonjour)") {
                HStack {
                    Text("Statut Bonjour")
                    Spacer()
                    Text(discoveryStateLabel)
                        .foregroundStyle(.secondary)
                }

                Button("Redémarrer la recherche") {
                    discovery.stop()
                    discovery.start()
                }
            }

            Section("Liaison & Reconnexion") {
                Button("Réessayer la connexion") {
                    discovery.stop()
                    discovery.start()
                    engine.ensureConnected()
                }
            }

            Section("Maintenance & Remise à Plat (Serveur)") {
                Button("Redémarrer le Tunnel (Serveur)") {
                    engine.restartTunnel()
                }
                .disabled(engine.state != .connected)

                Button("Redémarrer le Service Bonjour (Serveur)") {
                    engine.restartMdns()
                }
                .disabled(engine.state != .connected)

                Button(role: .destructive) {
                    showRestartConfirmation = true
                } label: {
                    if isRestartingServices {
                        HStack {
                            ProgressView()
                            Text("Remise à plat en cours...")
                        }
                    } else {
                        Text("Remise à plat complète (Python + Bonjour + Tunnel)")
                    }
                }
                .disabled(engine.state != .connected || isRestartingServices)
                .confirmationDialog(
                    Text("Remise à plat du serveur ?"),
                    isPresented: $showRestartConfirmation,
                    titleVisibility: .visible
                ) {
                    Button("Remise à plat complète", role: .destructive) {
                        isRestartingServices = true
                        engine.restartServicesResult = nil
                        engine.restartServices()
                    }
                    Button("Annuler", role: .cancel) {}
                } message: {
                    Text(
                        "Coupe le tunnel actif, tue les process pymobiledevice3, "
                            + "redémarre le service Bonjour/mDNS, puis rétablit la connexion automatiquement."
                    )
                }
            } header: {
                Text("Remise à Plat")
            } footer: {
                if let result = engine.restartServicesResult {
                    restartResultSummary(result)
                } else {
                    Text("Commandes de remise à zéro à utiliser en cas de blocage persistant.")
                }
            }
        }
        .navigationTitle("Diagnostics")
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: engine.restartServicesResult?.succeeded) { _, _ in
            isRestartingServices = false
        }
    }

    @ViewBuilder
    private func restartResultSummary(_ result: RestartServicesResultPayload) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(
                result.succeeded
                    ? "Redémarrage réussi, tunnel rétabli."
                    : "Échec du redémarrage : \(result.error ?? "erreur inconnue")"
            )
            .foregroundStyle(result.succeeded ? .green : .red)
            ForEach(result.steps ?? [], id: \.name) { step in
                Text("\(step.succeeded ? "✓" : "✗") \(step.name)" + (step.error.map { " — \($0)" } ?? ""))
                    .font(.caption)
                    .foregroundStyle(step.succeeded ? Color.secondary : Color.red)
            }
        }
    }

    private var connectionColor: Color {
        switch engine.state {
        case .connected: return .green
        case .connecting, .reconnecting: return .orange
        case .disconnected: return .secondary
        }
    }

    private func latencyColor(_ milliseconds: Double) -> Color {
        if milliseconds < 50 { return .green }
        if milliseconds < 200 { return .orange }
        return .red
    }

    private var discoveryStateLabel: String {
        switch discovery.state {
        case .idle: return "Inactif"
        case .searching: return "Recherche en cours..."
        case .found(let host, let port): return "Trouvé (\(host):\(port))"
        case .notFound: return "Non trouvé"
        }
    }
}
