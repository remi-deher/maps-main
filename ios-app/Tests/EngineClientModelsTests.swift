import XCTest
@testable import GpsMockCompanion

final class EngineClientModelsTests: XCTestCase {

    func testEngineStatusDecodesJitterEnabled() throws {
        let json = """
        {"state":"idle","jitterEnabled":false}
        """
        let status = try JSONDecoder().decode(EngineStatus.self, from: Data(json.utf8))
        XCTAssertEqual(status.jitterEnabled, false)
    }

    func testEngineStatusDecodesActiveCirclePatrolZone() throws {
        let json = """
        {
          "state": "moving",
          "patrolZone": {
            "type": "circle",
            "center": {"lat": 48.8566, "lon": 2.3522},
            "radius": 200,
            "active": true
          }
        }
        """
        let status = try JSONDecoder().decode(EngineStatus.self, from: Data(json.utf8))
        let zone = try XCTUnwrap(status.patrolZone)
        XCTAssertEqual(zone.type, "circle")
        XCTAssertEqual(zone.active, true)
        XCTAssertEqual(zone.radius, 200)
        XCTAssertEqual(zone.center?.lat, 48.8566)
        XCTAssertNil(zone.bounds)
    }

    func testEngineStatusDecodesRectanglePatrolZoneBounds() throws {
        let json = """
        {
          "state": "moving",
          "patrolZone": {
            "type": "rectangle",
            "bounds": {
              "sw": {"lat": 48.85, "lon": 2.35},
              "ne": {"lat": 48.86, "lon": 2.36}
            },
            "active": true
          }
        }
        """
        let status = try JSONDecoder().decode(EngineStatus.self, from: Data(json.utf8))
        let zone = try XCTUnwrap(status.patrolZone)
        XCTAssertEqual(zone.type, "rectangle")
        XCTAssertNil(zone.center)
        let bounds = try XCTUnwrap(zone.bounds)
        XCTAssertEqual(bounds.southWest.lat, 48.85)
        XCTAssertEqual(bounds.northEast.lat, 48.86)
    }

    func testEngineStatusWithoutPatrolZoneOrJitterDecodesAsNil() throws {
        let json = """
        {"state":"idle"}
        """
        let status = try JSONDecoder().decode(EngineStatus.self, from: Data(json.utf8))
        XCTAssertNil(status.patrolZone)
        XCTAssertNil(status.jitterEnabled)
    }

    func testEngineStatusDecodesNavigationStatus() throws {
        let json = """
        {
          "state": "running",
          "navigation": {
            "status": {
              "state": "running",
              "index": 4,
              "total": 42
            },
            "progress": {
              "index": 4,
              "total": 42,
              "lat": 48.8566,
              "lon": 2.3522,
              "speed": 5
            }
          }
        }
        """
        let status = try JSONDecoder().decode(EngineStatus.self, from: Data(json.utf8))
        XCTAssertEqual(status.navigation?.status?.state, "running")
        XCTAssertEqual(status.navigation?.status?.index, 4)
        XCTAssertEqual(status.navigation?.progress?.speed, 5)
    }
}
