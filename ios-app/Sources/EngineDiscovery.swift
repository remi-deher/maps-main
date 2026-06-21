import Foundation
import Network

/// Browses for the engine advertising itself as `_gpsmock._tcp` on the LAN
/// (see engine/cmd/headless/run.go, advertiseMdns) so the user never has to
/// type an IP:port by hand. Falls back gracefully — manual entry in
/// ContentView still works if discovery finds nothing or local-network
/// permission is denied.
final class EngineDiscovery: ObservableObject {
    enum State: Equatable {
        case idle
        case searching
        case found(host: String, port: Int)
        case notFound
    }

    @Published var state: State = .idle

    private var browser: NWBrowser?
    private var resolveConnection: NWConnection?

    func start() {
        state = .searching

        let parameters = NWParameters()
        parameters.includePeerToPeer = true
        let browser = NWBrowser(for: .bonjour(type: "_gpsmock._tcp", domain: nil), using: parameters)
        self.browser = browser

        AppLogger.shared.info("Découverte Bonjour démarrée (_gpsmock._tcp)")

        browser.stateUpdateHandler = { [weak self] newState in
            if case .failed(let error) = newState {
                AppLogger.shared.warn("Découverte Bonjour échouée: \(error.localizedDescription)")
                DispatchQueue.main.async { self?.state = .notFound }
            }
        }

        browser.browseResultsChangedHandler = { [weak self] results, _ in
            guard let self, let first = results.first else { return }
            self.resolve(first.endpoint)
        }

        browser.start(queue: .main)

        // Give discovery a few seconds before giving up and falling back to
        // manual entry — mDNS on a busy/unusual LAN can be slow.
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
            guard let self, self.state == .searching else { return }
            AppLogger.shared.warn("Découverte Bonjour: aucun moteur trouvé après 5s")
            self.state = .notFound
            self.stop()
        }
    }

    func stop() {
        browser?.cancel()
        browser = nil
        resolveConnection?.cancel()
        resolveConnection = nil
    }

    private func resolve(_ endpoint: NWEndpoint) {
        let connection = NWConnection(to: endpoint, using: .tcp)
        resolveConnection = connection

        connection.stateUpdateHandler = { [weak self] newState in
            guard let self, newState == .ready else { return }
            defer { connection.cancel() }

            guard let innerEndpoint = connection.currentPath?.remoteEndpoint,
                  case let .hostPort(host, port) = innerEndpoint else { return }

            let hostString = "\(host)".split(separator: "%").first.map(String.init) ?? "\(host)"
            AppLogger.shared.info("Moteur trouvé en Bonjour: \(hostString):\(port.rawValue)")
            DispatchQueue.main.async {
                self.state = .found(host: hostString, port: Int(port.rawValue))
                self.stop()
            }
        }
        connection.start(queue: .main)
    }
}
