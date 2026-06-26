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
    //
    // Every target in this project builds unsigned (CODE_SIGNING_ALLOWED=NO in
    // project.yml — AltStore resigns the .ipa on-device at install time), and
    // a fully unsigned test host can't always be granted the default Keychain
    // access group by securityd. When that's the case here, EngineTokenStore's
    // save reports it via its Bool return rather than silently losing the
    // write, and these tests skip (not fail) so a CI-only signing limitation
    // doesn't mask itself as a logic regression — while still asserting the
    // real round-trip whenever Keychain access *is* granted.

    func testTokenStoreRoundTrip() throws {
        let address = "test-\(UUID().uuidString):8080"
        defer { EngineTokenStore.clear(forAddress: address) }

        XCTAssertNil(EngineTokenStore.token(forAddress: address))
        try XCTSkipUnless(EngineTokenStore.save(token: "dev.secret", forAddress: address), "Keychain access unavailable in this environment")
        XCTAssertEqual(EngineTokenStore.token(forAddress: address), "dev.secret")

        // Re-saving upserts rather than duplicating.
        XCTAssertTrue(EngineTokenStore.save(token: "dev.secret2", forAddress: address))
        XCTAssertEqual(EngineTokenStore.token(forAddress: address), "dev.secret2")

        EngineTokenStore.clear(forAddress: address)
        XCTAssertNil(EngineTokenStore.token(forAddress: address))
    }

    func testTokenStoreIsolatesByAddress() throws {
        let a = "a-\(UUID().uuidString):8080"
        let b = "b-\(UUID().uuidString):8080"
        defer { EngineTokenStore.clear(forAddress: a); EngineTokenStore.clear(forAddress: b) }

        try XCTSkipUnless(EngineTokenStore.save(token: "token-a", forAddress: a), "Keychain access unavailable in this environment")
        XCTAssertTrue(EngineTokenStore.save(token: "token-b", forAddress: b))
        XCTAssertEqual(EngineTokenStore.token(forAddress: a), "token-a")
        XCTAssertEqual(EngineTokenStore.token(forAddress: b), "token-b")
    }
}
