import XCTest
import CoreLocation
import UniformTypeIdentifiers
@testable import GpsMockCompanion

final class GPXTests: XCTestCase {

    func testDocumentProducesWellFormedTrkpts() {
        let points = [
            CLLocationCoordinate2D(latitude: 48.8566, longitude: 2.3522),
            CLLocationCoordinate2D(latitude: 48.8580, longitude: 2.3540),
        ]
        let gpx = GPX.document(name: "Test Route", points: points)

        XCTAssertTrue(gpx.contains("<?xml version=\"1.0\" encoding=\"UTF-8\"?>"))
        XCTAssertTrue(gpx.contains("<name>Test Route</name>"))
        XCTAssertTrue(gpx.contains("<trkpt lat=\"48.8566\" lon=\"2.3522\">"))
        XCTAssertTrue(gpx.contains("<trkpt lat=\"48.858\" lon=\"2.354\">"))
        XCTAssertEqual(gpx.components(separatedBy: "<trkpt").count - 1, 2)
    }

    func testDocumentWithNoPointsStillProducesValidShell() {
        let gpx = GPX.document(name: "Empty", points: [])
        XCTAssertTrue(gpx.contains("<trkseg>"))
        XCTAssertTrue(gpx.contains("</trkseg>"))
        XCTAssertFalse(gpx.contains("<trkpt"))
    }

    func testGPXFileRoundTripsThroughFileDocumentInit() throws {
        let original = GPX.document(name: "Round Trip", points: [
            CLLocationCoordinate2D(latitude: 1, longitude: 2),
        ])
        let exported = GPXFile(content: original)
        XCTAssertEqual(exported.content, original)
    }

    func testUTTypeGpxConformsToXML() {
        XCTAssertTrue(UTType.gpx.conforms(to: .xml))
    }
}
