import SwiftUI
import CoreLocation

struct DiagnosticsView: View {
    var engine: EngineClient
    var discovery: EngineDiscovery

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
        }
        .navigationTitle("Diagnostics")
        .navigationBarTitleDisplayMode(.inline)
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
