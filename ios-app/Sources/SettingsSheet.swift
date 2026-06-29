import SwiftUI
import UniformTypeIdentifiers
import CoreLocation
import MapKit
import UIKit

// Connection settings, moved out of the main map screen behind a gear icon
// so the primary UI stays just the map + omnibar.
//
// The settings are organized as a top-level category menu (à la Réglages.app /
// Plans) that pushes focused sub-screens, rather than one flat 14-section wall
// where every concern — one-time setup, per-session operations, set-and-forget
// preferences — carried the same visual weight. Pushing each category as a
// `NavigationLink` also resolves §3.11 of docs/UI_UX_BASELINE.md: LogsView and
// the QR scanner now stack inside this sheet's own NavigationStack instead of
// opening a second simultaneous sheet on the same presenter.
struct SettingsSheet: View {
    @Binding var engineAddress: String
    var engine: EngineClient
    var discovery: EngineDiscovery
    var onToggleConnection: () -> Void
    var onRetryDiscovery: () -> Void
    var onApplyPort: () -> Void
    @Binding var liveActivityEnabled: Bool
    @Binding var keepAliveEnabled: Bool
    @Binding var keepAliveInterval: Double
    @Binding var notificationsEnabled: Bool
    var locationAuthorization: CLAuthorizationStatus

    // Persisted defaults reused across the app (ContentView reads the same
    // keys via @AppStorage) — editing them here updates everywhere.
    @AppStorage("defaultSpeed") var defaultSpeed: Double = 30
    @AppStorage("defaultProfile") var defaultProfile: String = "driving"
    @AppStorage("locationAccuracyMode") var locationAccuracyMode: String = "balanced"

    @Environment(\.openURL) var openURL

    @State var selectedDriver = "go-ios"
    // No USB/WiFi/Auto picker: the tunnel daemon (go-ios/pymobiledevice3) decides
    // USB vs network on its own — it runs over a virtual adapter either way, so
    // the app can't actually steer that choice. Leaving wifiAddress empty keeps
    // "auto"; filling it targets that RSD endpoint directly.
    @State var wifiAddress = ""
    @State var jitterEnabled = true
    @State var portInput = ""
    @State var portError: String?

    // Remote-access pairing: the 6-digit code typed manually (or pre-filled from
    // a scanned QR), an in-flight flag to disable the button, and a status line
    // for success/error feedback.
    @State var pairingCode = ""
    @State var pairingInProgress = false
    @State var pairingStatus: String?

    @State var showQrScanner = false

    @Environment(\.dismiss) var dismiss

    // swiftlint:disable:next cyclomatic_complexity
    var body: some View {
        NavigationStack {
            List {
                Section {
                    NavigationLink {
                        connexionScreen
                    } label: {
                        Label("Connexion", systemImage: "antenna.radiowaves.left.and.right")
                    }
                    NavigationLink {
                        simulationScreen
                    } label: {
                        Label("Simulation", systemImage: "speedometer")
                    }
                    NavigationLink {
                        backgroundScreen
                    } label: {
                        Label("Arrière-plan et batterie", systemImage: "battery.100")
                    }
                    NavigationLink {
                        toolsScreen
                    } label: {
                        Label("Outils", systemImage: "wrench.and.screwdriver")
                    }
                    NavigationLink {
                        aboutScreen
                    } label: {
                        Label("À propos", systemImage: "info.circle")
                    }
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
                if let activeDriver = engine.status?.deviceInfo?.driver {
                    selectedDriver = activeDriver
                } else if let usbDriver = engine.status?.usbDriver {
                    selectedDriver = usbDriver
                }
            }
            .onChange(of: engine.status, perform: { status in
                if let status {
                    if let value = status.jitterEnabled {
                        jitterEnabled = value
                    }
                    if let activeDriver = status.deviceInfo?.driver {
                        selectedDriver = activeDriver
                    } else if let usbDriver = status.usbDriver {
                        selectedDriver = usbDriver
                    }
                }
            }
            .onChange(of: selectedDriver, perform: { newValue in
                let current = engine.status?.deviceInfo?.driver ?? engine.status?.usbDriver ?? "go-ios"
                if newValue != current {
                    engine.switchDriver(driverId: newValue, transport: wifiAddress.isEmpty ? "auto" : "wifi", wifiAddress: wifiAddress)
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
}
