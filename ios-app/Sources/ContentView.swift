import SwiftUI
import CoreLocation

struct ContentView: View {
    @AppStorage("engineAddress") private var engineAddress: String = "192.168.1.1:8080"
    @StateObject private var location = LocationManager()
    @StateObject private var engine = EngineClient()
    @State private var reportTimer: Timer?

    var body: some View {
        NavigationView {
            Form {
                Section("Moteur GPS-Mock") {
                    TextField("IP:port (ex: 192.168.1.42:8080)", text: $engineAddress)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)

                    HStack {
                        Text("État")
                        Spacer()
                        Text(engine.state.rawValue)
                            .foregroundStyle(engine.state == .connected ? .green : .secondary)
                    }

                    if let drift = engine.lastDrift {
                        HStack {
                            Text("Dérive détectée")
                            Spacer()
                            Text("\(Int(drift)) m")
                                .foregroundStyle(drift > 100 ? .orange : .green)
                        }
                    }

                    if let error = engine.lastError {
                        Text(error).font(.caption).foregroundStyle(.red)
                    }

                    Button(engine.state == .connected || engine.state == .connecting ? "Déconnecter" : "Connecter") {
                        toggleConnection()
                    }
                }

                Section("Position réelle (anti-dérive)") {
                    HStack {
                        Text("Permission")
                        Spacer()
                        Text(permissionLabel)
                            .foregroundStyle(.secondary)
                    }
                    if location.authorizationStatus == .notDetermined {
                        Button("Autoriser la localisation") {
                            location.requestPermission()
                        }
                    }
                    if let loc = location.lastLocation {
                        Text("\(loc.coordinate.latitude, specifier: "%.5f"), \(loc.coordinate.longitude, specifier: "%.5f")")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Section {
                    Text("L'app envoie votre position réelle au moteur toutes les 10 secondes. Le moteur s'en sert pour confirmer que la position simulée est bien prise en compte par l'iPhone, et la réinjecte si elle a trop dérivé.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("GPS-Mock Companion")
        }
        .onAppear { location.requestPermission() }
    }

    private var permissionLabel: String {
        switch location.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse: return "Autorisée"
        case .denied, .restricted: return "Refusée"
        default: return "Non demandée"
        }
    }

    private func toggleConnection() {
        if engine.state == .connected || engine.state == .connecting {
            stopReporting()
            engine.disconnect()
            return
        }
        let url = "ws://\(engineAddress)/ws"
        engine.connect(to: url)
        startReporting()
    }

    private func startReporting() {
        reportTimer?.invalidate()
        reportTimer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { _ in
            guard let loc = location.lastLocation else { return }
            engine.sendRealLocation(lat: loc.coordinate.latitude, lon: loc.coordinate.longitude)
        }
    }

    private func stopReporting() {
        reportTimer?.invalidate()
        reportTimer = nil
    }
}

#Preview {
    ContentView()
}
