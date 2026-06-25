import SwiftUI
import CoreLocation
import MapKit
import UIKit

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

    /// A human label for this device in the desktop's paired-devices list.
    var pairingLabel: String { UIDevice.current.name }

    /// Handles a scanned QR payload. Two shapes are accepted (EnginePairing.parse):
    ///   - The desktop's "Accès distant" QR — "http://host:port/?pair=<code>" —
    ///     which carries the rotating code, so a single scan both targets the
    ///     engine *and* pairs (redeeming the code for a durable token).
    ///   - The legacy "host:port" QR — no code; we just point at the engine and
    ///     connect (the user pairs separately via the code field if the engine
    ///     now requires it).
    /// Mistrusts the payload like a typed address: anything unparseable fails
    /// the shape check rather than being used unvalidated.
    func applyScannedAddress(_ value: String) {
        guard let link = EnginePairing.parse(value) else {
            portError = "QR Code invalide — ce n'est pas une adresse de moteur GPS-Mock."
            return
        }
        portError = nil
        engineAddress = link.address
        portInput = String(link.port)
        if let code = link.code {
            redeem(code: code, host: link.host, port: link.port, address: link.address)
        } else {
            onApplyPort()
        }
    }

    /// Pairs using the 6-digit code typed manually against the current
    /// `engineAddress`. Used when the camera isn't available or the user reads
    /// the code off the desktop screen.
    func pairManually() {
        guard let link = EnginePairing.parse(engineAddress) else {
            pairingStatus = "Renseignez d'abord une adresse hôte valide."
            return
        }
        let code = pairingCode.filter(\.isNumber)
        guard code.count == 6 else {
            pairingStatus = "Le code doit comporter 6 chiffres."
            return
        }
        redeem(code: code, host: link.host, port: link.port, address: link.address)
    }

    /// Shared redemption path: POST the code, persist the returned token keyed
    /// by engine address, then connect. On failure surface the reason and leave
    /// any previously stored token untouched.
    private func redeem(code: String, host: String, port: Int, address: String) {
        pairingInProgress = true
        pairingStatus = "Appairage en cours…"
        // Read the device label on the main actor before hopping off it.
        let label = pairingLabel
        Task {
            do {
                let token = try await EnginePairing.redeem(host: host, port: port, code: code, label: label)
                EngineTokenStore.save(token: token, forAddress: address)
                await MainActor.run {
                    pairingInProgress = false
                    pairingStatus = "Appareil appairé."
                    pairingCode = ""
                    onApplyPort()
                }
            } catch {
                await MainActor.run {
                    pairingInProgress = false
                    pairingStatus = (error as? EnginePairing.PairingError)?.errorDescription ?? error.localizedDescription
                }
            }
        }
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
