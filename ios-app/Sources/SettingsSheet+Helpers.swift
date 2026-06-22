import SwiftUI
import CoreLocation
import MapKit

// Computed properties and actions split into an extension (in its own file) so
// each source file stays under SwiftLint's file_length / type_body_length limits.
extension SettingsSheet {
    var appVersion: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(version) (\(build))"
    }

    var authorizationIsAlways: Bool {
        locationAuthorization == .authorizedAlways
    }

    var authorizationLabel: String {
        switch locationAuthorization {
        case .authorizedAlways: return "Accordée"
        case .authorizedWhenInUse: return "Pendant l'usage"
        case .denied, .restricted: return "Refusée"
        case .notDetermined: return "À demander"
        @unknown default: return "Inconnue"
        }
    }

    /// Accepts the raw "host:port" string scanned from tauri-app's pairing
    /// QR code (Sidebar.tsx's `qrPairingAddress`) and reconnects to it.
    /// Mistrusts the payload exactly like a manually-typed address: a
    /// malformed scan (wrong app, damaged code) just fails the host:port
    /// shape check below rather than being passed anywhere unvalidated.
    func applyScannedAddress(_ value: String) {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let parts = trimmed.split(separator: ":")
        guard parts.count == 2, let port = Int(parts[1]), (1...65535).contains(port), !parts[0].isEmpty else {
            portError = "QR Code invalide — ce n'est pas une adresse de moteur GPS-Mock."
            return
        }
        portError = nil
        engineAddress = trimmed
        portInput = String(port)
        onApplyPort()
    }

    /// Replaces the port suffix of `engineAddress` (host:port) and
    /// reconnects — the closest iOS equivalent to tauri-app's dedicated
    /// engine-port field: tauri restarts a locally-spawned sidecar process
    /// on a new port, but iOS only ever talks to a *remote* engine, so
    /// there's no process to restart — changing the port just means
    /// reconnecting to the same host on a different one.
    func applyPort() {
        guard let port = Int(portInput), (1...65535).contains(port) else {
            portError = "Port invalide (1-65535)."
            return
        }
        portError = nil
        let host = engineAddress.split(separator: ":").first.map(String.init) ?? engineAddress
        guard !host.isEmpty else {
            portError = "Renseignez d'abord une adresse hôte."
            return
        }
        engineAddress = "\(host):\(port)"
        onApplyPort()
    }

    @ViewBuilder
    var discoveryRow: some View {
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
