import CoreLocation
import UniformTypeIdentifiers
import SwiftUI

/// Builds and reads GPX track files. Parsing of imported content happens
/// server-side (engine/internal/engine/simulation.go's PLAY_CUSTOM_GPX
/// handler scans for `<trkpt>` tags itself), so this app only needs to read
/// the raw file text — mirroring tauri-app's Sidebar.tsx, which likewise
/// uploads the file's text content as-is rather than parsing it locally.
enum GPX {
    /// Builds a GPX 1.1 track document from a sequence of points, in the
    /// same shape tauri-app's `exportDrawnGpx` produces.
    static func document(name: String, points: [CLLocationCoordinate2D]) -> String {
        var gpx = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
        gpx += "<gpx version=\"1.1\" creator=\"GPS-Mock iOS\" xmlns=\"http://www.topografix.com/GPX/1/1\">\n"
        gpx += "  <trk>\n"
        gpx += "    <name>\(name)</name>\n"
        gpx += "    <trkseg>\n"
        for point in points {
            gpx += "      <trkpt lat=\"\(point.latitude)\" lon=\"\(point.longitude)\"></trkpt>\n"
        }
        gpx += "    </trkseg>\n"
        gpx += "  </trk>\n"
        gpx += "</gpx>"
        return gpx
    }
}

/// Plain-text export document so `.fileExporter` can hand a GPX track to the
/// system's save/share sheet without an intermediate temp file.
struct GPXFile: FileDocument {
    static var readableContentTypes: [UTType] { [.gpx] }
    static var writableContentTypes: [UTType] { [.gpx] }

    var content: String

    init(content: String) {
        self.content = content
    }

    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents,
              let text = String(data: data, encoding: .utf8) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        content = text
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: Data(content.utf8))
    }
}

extension UTType {
    /// GPX has no system-registered UTType, so declare it the same way
    /// tauri-app recognizes it: by the `.gpx` extension and the
    /// `application/gpx+xml` MIME type used in its drag-and-drop handler.
    static let gpx = UTType(filenameExtension: "gpx", conformingTo: .xml) ?? .xml
}
