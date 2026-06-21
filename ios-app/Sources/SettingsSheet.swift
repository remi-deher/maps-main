import SwiftUI
import UniformTypeIdentifiers
import CoreLocation
import MapKit

/// Connection settings, moved out of the main map screen behind a gear icon
/// so the primary UI stays just the map + omnibar.
struct SettingsSheet: View {
    @Binding var engineAddress: String
    @ObservedObject var engine: EngineClient
    @ObservedObject var discovery: EngineDiscovery
    var onToggleConnection: () -> Void
    var onRetryDiscovery: () -> Void
    var onApplyPort: () -> Void
    @Binding var liveActivityEnabled: Bool
    @Binding var keepAliveEnabled: Bool
    @Binding var keepAliveInterval: Double
    @Binding var notificationsEnabled: Bool
    var patrolCenter: CLLocationCoordinate2D?
    var visibleRegion: MKCoordinateRegion?

    @State private var selectedDriver = "go-ios"
    @State private var selectedTransport = "auto"
    @State private var jitterEnabled = true
    @State private var portInput = ""
    @State private var portError: String?

    @State private var patrolType = "circle"
    @State private var patrolRadius: Double = 200
    @State private var patrolError: String?

    @State private var showGpxImporter = false
    @State private var gpxContent = ""
    @State private var gpxFileName = ""
    @State private var gpxSpeed: Double = 25
    @State private var gpxError: String?

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section("Découverte automatique") {
                    discoveryRow
                }

                Section("Moteur GPS-Mock") {
                    TextField("ex. 192.168.1.42:8080", text: $engineAddress, prompt: Text("Auto-découverte en cours…"))
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)

                    HStack {
                        Text("Port")
                        TextField("8080", text: $portInput)
                            .keyboardType(.numberPad)
                            .multilineTextAlignment(.trailing)
                        Button("Appliquer") {
                            applyPort()
                        }
                        .buttonStyle(.borderless)
                        .disabled(portInput.isEmpty)
                    }
                    if let portError {
                        Text(portError).font(.caption).foregroundStyle(.red)
                    }

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

                Section("Pilote iOS") {
                    Picker("Pilote", selection: $selectedDriver) {
                        Text("go-ios (natif)").tag("go-ios")
                        Text("pymobiledevice3 (Python)").tag("pymobiledevice")
                    }
                    Picker("Transport", selection: $selectedTransport) {
                        Text("Auto").tag("auto")
                        Text("USB").tag("usb")
                        Text("Wi-Fi").tag("wifi")
                    }
                    Button("Appliquer et relancer le tunnel") {
                        engine.switchDriver(driverId: selectedDriver, transport: selectedTransport)
                    }
                }

                Section("Simulation") {
                    Toggle("Bruit GPS (jitter)", isOn: $jitterEnabled)
                        .onChange(of: jitterEnabled) { _, newValue in
                            engine.saveSettings(["jitterEnabled": newValue])
                        }
                    Text("Ajoute une légère variation aléatoire à la position injectée, pour imiter le bruit naturel d'un vrai GPS.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Section("Live Activity") {
                    Toggle("Écran verrouillé / Dynamic Island", isOn: $liveActivityEnabled)
                    Text("Affiche l'état de la simulation en cours sans ouvrir l'application.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Section("Maintien en arrière-plan") {
                    Toggle("Garder la position active", isOn: $keepAliveEnabled)
                    if keepAliveEnabled {
                        Stepper(value: $keepAliveInterval, in: 2...60, step: 1) {
                            Text("Toutes les \(Int(keepAliveInterval)) s")
                        }
                    }
                    Text("Relance périodiquement la dernière position injectée pendant que l'app est en arrière-plan, "
                         + "pour qu'elle ne se perde pas. Nécessite l'autorisation de localisation « Toujours ».")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Section("Notifications") {
                    Toggle("Arrivée et déconnexion", isOn: $notificationsEnabled)
                    Text("Prévient quand un itinéraire se termine ou que la liaison avec le moteur est perdue.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Section("Zone de patrouille") {
                    Picker("Type de zone", selection: $patrolType) {
                        Text("Cercle (autour de la position)").tag("circle")
                        Text("Rectangle (zone visible à l'écran)").tag("rectangle")
                    }
                    if patrolType == "circle" {
                        HStack {
                            Text("Rayon")
                            Spacer()
                            Text("\(Int(patrolRadius)) m").foregroundStyle(.secondary)
                        }
                        Slider(value: $patrolRadius, in: 50...2000, step: 50)
                    } else {
                        Text("Utilise la zone actuellement visible sur la carte comme rectangle de patrouille.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if let patrolError {
                        Text(patrolError).font(.caption).foregroundStyle(.red)
                    }
                    if engine.status?.patrolZone?.active == true {
                        Button("Arrêter la patrouille", role: .destructive) {
                            engine.updatePatrolZone(type: patrolType, center: nil, radius: nil, bounds: nil, active: false)
                        }
                    } else {
                        Button("Lancer la patrouille") {
                            startPatrol()
                        }
                    }
                }

                Section("Importation GPX") {
                    Button {
                        showGpxImporter = true
                    } label: {
                        Label(gpxFileName.isEmpty ? "Choisir un fichier .gpx" : gpxFileName, systemImage: "doc.badge.plus")
                    }
                    if let gpxError {
                        Text(gpxError).font(.caption).foregroundStyle(.red)
                    }
                    if !gpxContent.isEmpty {
                        Stepper(value: $gpxSpeed, in: 1...250, step: 5) {
                            HStack {
                                Text("Vitesse de simulation")
                                Spacer()
                                Text("\(Int(gpxSpeed)) km/h").foregroundStyle(.secondary)
                            }
                        }
                        Button("Lancer la simulation GPX") {
                            engine.playCustomGpx(gpxContent: gpxContent, speed: gpxSpeed)
                            dismiss()
                        }
                    }
                }

                Section("Administration") {
                    Button("Relancer la dernière position") {
                        engine.relance()
                    }
                    Button("Vider l'historique récent", role: .destructive) {
                        engine.clearHistory()
                    }
                }

                Section {
                    NavigationLink {
                        LogsView(engine: engine)
                    } label: {
                        HStack {
                            Text("Journaux du moteur")
                            Spacer()
                            Text("\(engine.logs.count)").foregroundStyle(.secondary)
                        }
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
            .onAppear {
                if let value = engine.status?.jitterEnabled {
                    jitterEnabled = value
                }
                if let port = engineAddress.split(separator: ":").last {
                    portInput = String(port)
                }
            }
            .fileImporter(isPresented: $showGpxImporter, allowedContentTypes: [.gpx, .xml]) { result in
                switch result {
                case .success(let url):
                    loadGpx(from: url)
                case .failure(let error):
                    gpxError = error.localizedDescription
                }
            }
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    // "Terminé" (not "Fermer") matches the HIG convention for
                    // dismissing a settings sheet where nothing is confirmed
                    // or cancelled — see §3.15 of docs/UI_UX_BASELINE.md.
                    Button("Terminé") { dismiss() }
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
    private func applyPort() {
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

    /// Starts a circle patrol centered on the current spoofed/real position
    /// (mirroring tauri-app's `center: currentPos`), or a rectangle patrol
    /// using the map's current visible bounds — iOS has no free-draw mode,
    /// so "what's currently on screen" stands in for tauri's never-actually-
    /// wired rectangle drawing (it only ever sends a circle's center+radius
    /// regardless of the selected type).
    private func startPatrol() {
        patrolError = nil
        if patrolType == "rectangle" {
            guard let region = visibleRegion else {
                patrolError = "Zone de carte indisponible."
                return
            }
            let sw = CLLocationCoordinate2D(
                latitude: region.center.latitude - region.span.latitudeDelta / 2,
                longitude: region.center.longitude - region.span.longitudeDelta / 2
            )
            let ne = CLLocationCoordinate2D(
                latitude: region.center.latitude + region.span.latitudeDelta / 2,
                longitude: region.center.longitude + region.span.longitudeDelta / 2
            )
            engine.updatePatrolZone(type: "rectangle", center: nil, radius: nil, bounds: (sw: sw, ne: ne), active: true)
        } else {
            guard let center = patrolCenter else {
                patrolError = "Position de départ indisponible."
                return
            }
            engine.updatePatrolZone(type: "circle", center: center, radius: patrolRadius, bounds: nil, active: true)
        }
    }

    private func loadGpx(from url: URL) {
        gpxError = nil
        guard url.startAccessingSecurityScopedResource() else {
            gpxError = "Accès au fichier refusé."
            return
        }
        defer { url.stopAccessingSecurityScopedResource() }
        guard let text = try? String(contentsOf: url, encoding: .utf8), text.contains("<trkpt") else {
            gpxError = "Fichier GPX invalide ou vide."
            return
        }
        gpxContent = text
        gpxFileName = url.lastPathComponent
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
