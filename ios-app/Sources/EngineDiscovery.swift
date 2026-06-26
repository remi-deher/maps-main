import Foundation
import Network
import Observation

/// Browses for the engine advertising itself as `_gpsmock._tcp` on the LAN
/// (see engine/cmd/headless/run.go, advertiseMdns) so the user never has to
/// type an IP:port by hand. Falls back gracefully — manual entry in
/// ContentView still works if discovery finds nothing or local-network
/// permission is denied.
@Observable
final class EngineDiscovery {
    enum State: Equatable {
        case idle
        case searching
        case found(host: String, port: Int)
        case notFound
    }

    var state: State = .idle

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
        // Force IPv4 resolution. On a dual-stack LAN the Bonjour record carries
        // both A and AAAA records, and the default stack often picks a
        // link-local IPv6 address (fe80::…%en0). Once the "%en0" zone id is
        // stripped below that address is unusable, so the WebSocket connection
        // drops. The engine always listens on IPv4, which works reliably, so we
        // pin resolution to v4 here.
        let parameters = NWParameters.tcp
        if let ipOptions = parameters.defaultProtocolStack.internetProtocol as? NWProtocolIP.Options {
            ipOptions.version = .v4
        }
        let connection = NWConnection(to: endpoint, using: parameters)
        resolveConnection = connection

        connection.stateUpdateHandler = { [weak self] newState in
            guard let self else { return }
            switch newState {
            case .ready:
                defer { connection.cancel() }
                guard let innerEndpoint = connection.currentPath?.remoteEndpoint,
                      case let .hostPort(host, port) = innerEndpoint else { return }

                let hostString = "\(host)".split(separator: "%").first.map(String.init) ?? "\(host)"
                // Guard against any IPv6 slipping through: only accept a dotted
                // IPv4 literal (or a hostname), never a colon-bearing v6 address.
                guard !hostString.contains(":") else {
                    AppLogger.shared.warn("Bonjour: adresse IPv6 ignorée (\(hostString))")
                    return
                }
                AppLogger.shared.info("Moteur trouvé en Bonjour: \(hostString):\(port.rawValue)")
                DispatchQueue.main.async {
                    self.state = .found(host: hostString, port: Int(port.rawValue))
                    self.stop()
                }
            case .failed(let error):
                AppLogger.shared.warn("Bonjour: résolution IPv4 échouée: \(error.localizedDescription)")
                connection.cancel()
            default:
                break
            }
        }
        connection.start(queue: .main)
    }
}
