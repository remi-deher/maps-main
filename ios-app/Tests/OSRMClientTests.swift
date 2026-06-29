import XCTest
import CoreLocation
@testable import GpsMockCompanion

final class OSRMClientTests: XCTestCase {

    func testRouteProfileMapping() {
        XCTAssertEqual(OSRMClient.profile(for: "walking"), "walking")
        XCTAssertEqual(OSRMClient.profile(for: "driving"), "driving")
        XCTAssertEqual(OSRMClient.profile(for: "unknown"), "driving")
    }

    func testRouteStopInitialization() {
        let coordinate = CLLocationCoordinate2D(latitude: 48.8566, longitude: 2.3522)
        let stop = RouteStop(coordinate: coordinate, name: "Paris")
        XCTAssertEqual(stop.name, "Paris")
        XCTAssertEqual(stop.coordinate.latitude, 48.8566)
        XCTAssertEqual(stop.coordinate.longitude, 2.3522)
    }
}
