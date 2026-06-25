import Foundation
import Security

/// Remote-access pairing for the companion, mirroring the engine's auth model
/// (engine/internal/auth + server/pair.go). A remote client — which the iPhone
/// always is, talking to the engine over Wi-Fi — must redeem the desktop's
/// rotating 6-digit code once to obtain a durable "<deviceID>.<secret>" token,
/// then present that token on every later connection. The engine trusts
/// loopback without a token, but never a LAN peer, so without this the socket
/// is rejected.
///
/// The pieces here are split so the parsing/URL logic stays pure and unit-
/// testable, while the Keychain and network calls live behind thin wrappers.
enum EnginePairing {
    /// A scanned QR payload (or pasted link) resolved to its parts. Two shapes
    /// are accepted:
    ///   - Legacy "host:port" — the old iOS-pairing QR; carries no code.
    ///   - "http://host:port/?pair=<code>" — the desktop's "Accès distant" QR,
    ///     which also embeds the rotating code so a scan can pair in one step.
    struct ParsedLink: Equatable {
        let host: String
        let port: Int
        let code: String?

        var address: String { "\(host):\(port)" }
    }

    /// Parses a scanned/typed payload into a ParsedLink, or nil if it isn't a
    /// recognizable engine address. Validation matches the desktop side: a
    /// host and a port in 1...65535.
    static func parse(_ raw: String) -> ParsedLink? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        if trimmed.lowercased().hasPrefix("http://") || trimmed.lowercased().hasPrefix("https://") {
            guard let comps = URLComponents(string: trimmed),
                  let host = comps.host, !host.isEmpty else { return nil }
            // The engine URL always carries an explicit port; fall back to the
            // scheme default only if somehow absent.
            let port = comps.port ?? (comps.scheme == "https" ? 443 : 80)
            guard (1...65535).contains(port) else { return nil }
            let code = comps.queryItems?.first(where: { $0.name == "pair" })?.value
            return ParsedLink(host: host, port: port, code: normalizedCode(code))
        }

        // Legacy "host:port".
        let parts = trimmed.split(separator: ":")
        guard parts.count == 2, let port = Int(parts[1]),
              (1...65535).contains(port), !parts[0].isEmpty else { return nil }
        return ParsedLink(host: String(parts[0]), port: port, code: nil)
    }

    /// Strips non-digits and keeps a code only if it's the expected 6 digits;
    /// anything else collapses to nil so a malformed `?pair=` is ignored rather
    /// than sent to the engine.
    static func normalizedCode(_ code: String?) -> String? {
        guard let code else { return nil }
        let digits = code.filter(\.isNumber)
        return digits.count == 6 ? digits : nil
    }

    /// Builds the WebSocket URL for an engine address, appending the durable
    /// token as a query param when present (browsers can't set headers on the
    /// WS handshake, and the engine accepts ?token= for exactly this reason).
    static func webSocketURL(address: String, token: String?) -> String {
        let base = "ws://\(address)/ws"
        guard let token, !token.isEmpty,
              let encoded = token.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) else {
            return base
        }
        return "\(base)?token=\(encoded)"
    }

    enum PairingError: LocalizedError {
        case badCode
        case unreachable
        case server(Int)
        case malformedResponse

        var errorDescription: String? {
            switch self {
            case .badCode: return "Code invalide ou expiré."
            case .unreachable: return "Moteur injoignable."
            case .server(let code): return "Échec de l'appairage (\(code))."
            case .malformedResponse: return "Réponse d'appairage invalide."
            }
        }
    }

    /// Redeems a pairing code for a durable token by POSTing it to the engine's
    /// /api/pair endpoint. On success the caller should persist the token via
    /// EngineTokenStore so every later connection reuses it without re-pairing.
    static func redeem(host: String, port: Int, code: String, label: String, session: URLSession = .shared) async throws -> String {
        guard let url = URL(string: "http://\(host):\(port)/api/pair") else {
            throw PairingError.unreachable
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["code": code, "label": label])

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw PairingError.unreachable
        }
        guard let http = response as? HTTPURLResponse else { throw PairingError.malformedResponse }
        if http.statusCode == 401 { throw PairingError.badCode }
        guard http.statusCode == 200 else { throw PairingError.server(http.statusCode) }

        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = obj["token"] as? String, !token.isEmpty else {
            throw PairingError.malformedResponse
        }
        return token
    }
}

/// Keychain-backed storage for durable device tokens, keyed by engine address
/// ("host:port"). One token per engine: re-pairing a given engine overwrites
/// its entry, and revoking from the desktop just makes the stored token stop
/// working (the next connection fails and the user can re-pair).
enum EngineTokenStore {
    private static let service = "com.remi2.gpsmock.companion.engineToken"

    static func token(forAddress address: String) -> String? {
        guard !address.isEmpty else { return nil }
        var query = baseQuery(address)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data, let token = String(data: data, encoding: .utf8) else {
            return nil
        }
        return token
    }

    static func save(token: String, forAddress address: String) {
        guard !address.isEmpty else { return }
        // Delete any existing entry first so this is a clean upsert.
        SecItemDelete(baseQuery(address) as CFDictionary)
        var attrs = baseQuery(address)
        attrs[kSecValueData as String] = Data(token.utf8)
        attrs[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(attrs as CFDictionary, nil)
    }

    static func clear(forAddress address: String) {
        guard !address.isEmpty else { return }
        SecItemDelete(baseQuery(address) as CFDictionary)
    }

    private static func baseQuery(_ address: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: address,
        ]
    }
}
