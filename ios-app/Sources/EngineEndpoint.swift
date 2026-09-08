import Foundation

// Where to reach an engine, and what to prove to it.
//
// Splitting the credential out of the URL is the point of this type: the engine
// still accepts `?token=` for older clients, but a token in a query string is
// copied into every access log it passes through, so the companion presents it
// as an Authorization header instead (see EnginePairing.webSocketEndpoint and
// EngineClient.startSocket).
struct EngineEndpoint: Equatable {
    let urlString: String
    // nil when the engine was never paired — which is legitimate for a
    // loopback engine, and rejected by the engine for anything else.
    let token: String?

    // Builds the handshake request, attaching the token as a bearer credential
    // when there is one. Returns nil for a malformed address, which the caller
    // surfaces as a connection error rather than silently not connecting.
    func makeRequest() -> URLRequest? {
        guard let url = URL(string: urlString) else { return nil }
        var request = URLRequest(url: url)
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return request
    }
}
