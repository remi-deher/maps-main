import SwiftUI
import UniformTypeIdentifiers
import UIKit

// MARK: - Category screens
//
// The five focused sub-screens pushed from SettingsSheet's top-level category
// menu. Kept in their own file so each source file stays under SwiftLint's
// file_length limit.

extension SettingsSheet {
    /// Engine address, port, QR pairing, driver/tunnel, and Bonjour discovery —
    /// everything you set up once to point the app at a running engine.
    @ViewBuilder
    var connexionScreen: some View {
        List {
            Section("Découverte automatique") {
                discoveryRow
            }

            Section("Moteur GPS-Mock") {
                TextField("ex. 192.168.1.42:8080", text: $engineAddress, prompt: Text("Auto-découverte en cours…"))
                    .keyboardType(.URL)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)

                Button {
                    showQrScanner = true
                } label: {
                    Label("Scanner le QR Code du moteur", systemImage: "qrcode.viewfinder")
                }

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
        }
        .navigationTitle("Connexion")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showQrScanner) {
            QRScannerSheet { scanned in
                applyScannedAddress(scanned)
            }
        }
    }

    /// Simulation tuning that isn't tied to a specific run: default speed/profile
    /// for new routes and GPS jitter. (The patrol zone moved to a map-driven
    /// mode in the bottom sheet — see PatrolPanel.)
    @ViewBuilder
    var simulationScreen: some View {
        List {
            Section("Simulation") {
                Toggle("Bruit GPS (jitter)", isOn: $jitterEnabled)
                    .onChange(of: jitterEnabled) { _, newValue in
                        engine.saveSettings(["jitterEnabled": newValue])
                    }
                Text("Ajoute une légère variation aléatoire à la position injectée, pour imiter le bruit naturel d'un vrai GPS.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Itinéraire par défaut") {
                Picker("Profil", selection: $defaultProfile) {
                    Text("Voiture").tag("driving")
                    Text("À pied").tag("walking")
                }
                Stepper(value: $defaultSpeed, in: 1...250, step: 5) {
                    HStack {
                        Text("Vitesse")
                        Spacer()
                        Text("\(Int(defaultSpeed)) km/h").foregroundStyle(.secondary)
                    }
                }
                Text("Valeurs utilisées par défaut pour une téléportation avec itinéraire ou un nouvel itinéraire.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Simulation")
        .navigationBarTitleDisplayMode(.inline)
    }

    /// Set-and-forget preferences that govern how the app behaves while it isn't
    /// in the foreground: keep-alive, location accuracy, Live Activity, notifs.
    @ViewBuilder
    var backgroundScreen: some View {
        List {
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

            Section("Localisation et batterie") {
                Picker("Précision", selection: $locationAccuracyMode) {
                    Text("Maximale").tag("high")
                    Text("Équilibrée").tag("balanced")
                    Text("Économie").tag("low")
                }
                Text("« Maximale » garde la liaison active même téléphone immobile en veille, au prix de la batterie. "
                     + "« Équilibrée » et « Économie » préservent la batterie mais le maintien en arrière-plan ne se "
                     + "réveille alors qu'en cas de mouvement (ou via le réveil périodique de secours).")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Notifications") {
                Toggle("Arrivée et déconnexion", isOn: $notificationsEnabled)
                Text("Prévient quand un itinéraire se termine ou que la liaison avec le moteur est perdue.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Arrière-plan et batterie")
        .navigationBarTitleDisplayMode(.inline)
    }

    /// Occasional, one-off operations: engine admin actions and the engine log
    /// viewer. (GPX import moved to the bottom sheet — see GpxPanel.)
    @ViewBuilder
    var toolsScreen: some View {
        List {
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
                NavigationLink {
                    DiagnosticsView(engine: engine, discovery: discovery)
                } label: {
                    Text("Outils de diagnostic")
                }
            }
        }
        .navigationTitle("Outils")
        .navigationBarTitleDisplayMode(.inline)
    }

    /// App version, the engine it talks to, and the always-on location grant
    /// the background keep-alive depends on.
    @ViewBuilder
    var aboutScreen: some View {
        List {
            Section("À propos") {
                HStack {
                    Text("Version")
                    Spacer()
                    Text(appVersion).foregroundStyle(.secondary)
                }
                HStack {
                    Text("Moteur")
                    Spacer()
                    Text(engineAddress.isEmpty ? "—" : engineAddress)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                HStack {
                    Text("Localisation « Toujours »")
                    Spacer()
                    Label(authorizationLabel, systemImage: authorizationIsAlways ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                        .labelStyle(.titleAndIcon)
                        .foregroundStyle(authorizationIsAlways ? .green : .orange)
                        .font(.subheadline)
                }
                if !authorizationIsAlways {
                    Button("Ouvrir les Réglages iOS") {
                        if let url = URL(string: UIApplication.openSettingsURLString) {
                            openURL(url)
                        }
                    }
                    Text("Le maintien en arrière-plan nécessite l'autorisation « Toujours ». Activez-la dans les Réglages iOS.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Section {
                Text("La position réelle est envoyée toutes les 10s pour le bouclier anti-dérive du moteur.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("À propos")
        .navigationBarTitleDisplayMode(.inline)
    }
}
