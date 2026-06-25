import XCTest
@testable import GpsMockCompanion

final class EnginePairingTests: XCTestCase {

    // MARK: - parse

    func testParseLegacyHostPort() {
        let link = EnginePairing.parse("192.168.1.42:8080")
        XCTAssertEqual(link, EnginePairing.ParsedLink(host: "192.168.1.42", port: 8080, code: nil))
    }

    func testParseRemoteAccessURLWithCode() {
        let link = EnginePairing.parse("http://192.168.1.42:8080/?pair=123456")
        XCTAssertEqual(link, EnginePairing.ParsedLink(host: "192.168.1.42", port: 8080, code: "123456"))
    }

    func testParseURLWithoutCode() {
        let link = EnginePairing.parse("http://10.0.0.5:9000/")
        XCTAssertEqual(link, EnginePairing.ParsedLink(host: "10.0.0.5", port: 9000, code: nil))
    }

    func testParseTrimsWhitespace() {
        XCTAssertEqual(EnginePairing.parse("  host.local:8080\n")?.address, "host.local:8080")
    }

    func testParseRejectsGarbage() {
        XCTAssertNil(EnginePairing.parse(""))
        XCTAssertNil(EnginePairing.parse("not-an-address"))
        XCTAssertNil(EnginePairing.parse("host:99999"))   // port out of range
        XCTAssertNil(EnginePairing.parse(":8080"))         // empty host
    }

    // MARK: - normalizedCode

    func testNormalizedCodeKeepsSixDigits() {
        XCTAssertEqual(EnginePairing.normalizedCode("123456"), "123456")
    }

    func testNormalizedCodeStripsSeparatorsButRejectsWrongLength() {
        // A malformed ?pair= value collapses to nil rather than being sent on.
        XCTAssertNil(EnginePairing.normalizedCode("12-34"))
        XCTAssertNil(EnginePairing.normalizedCode("1234567"))
        XCTAssertNil(EnginePairing.normalizedCode(nil))
    }

    // MARK: - webSocketURL

    func testWebSocketURLWithoutToken() {
        XCTAssertEqual(EnginePairing.webSocketURL(address: "host:8080", token: nil), "ws://host:8080/ws")
        XCTAssertEqual(EnginePairing.webSocketURL(address: "host:8080", token: ""), "ws://host:8080/ws")
    }

    func testWebSocketURLWithToken() {
        let url = EnginePairing.webSocketURL(address: "host:8080", token: "dev123.secret-AB_cd")
        XCTAssertEqual(url, "ws://host:8080/ws?token=dev123.secret-AB_cd")
    }

    // MARK: - EngineTokenStore (Keychain round-trip on the simulator)

    func testTokenStoreRoundTrip() {
        let address = "test-\(UUID().uuidString):8080"
        defer { EngineTokenStore.clear(forAddress: address) }

        XCTAssertNil(EngineTokenStore.token(forAddress: address))
        EngineTokenStore.save(token: "dev.secret", forAddress: address)
        XCTAssertEqual(EngineTokenStore.token(forAddress: address), "dev.secret")

        // Re-saving upserts rather than duplicating.
        EngineTokenStore.save(token: "dev.secret2", forAddress: address)
        XCTAssertEqual(EngineTokenStore.token(forAddress: address), "dev.secret2")

        EngineTokenStore.clear(forAddress: address)
        XCTAssertNil(EngineTokenStore.token(forAddress: address))
    }

    func testTokenStoreIsolatesByAddress() {
        let a = "a-\(UUID().uuidString):8080"
        let b = "b-\(UUID().uuidString):8080"
        defer { EngineTokenStore.clear(forAddress: a); EngineTokenStore.clear(forAddress: b) }

        EngineTokenStore.save(token: "token-a", forAddress: a)
        EngineTokenStore.save(token: "token-b", forAddress: b)
        XCTAssertEqual(EngineTokenStore.token(forAddress: a), "token-a")
        XCTAssertEqual(EngineTokenStore.token(forAddress: b), "token-b")
    }
}
