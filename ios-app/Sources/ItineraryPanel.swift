import SwiftUI
import CoreLocation
import UniformTypeIdentifiers

/// Drive-time/distance for the leg ending at a given stop, computed via
/// MKDirections (keyed by the destination RouteStop's id) — mirrors the ETA
/// Plans shows under each leg of a multi-stop trip.
struct LegEstimate {
    let distanceMeters: CLLocationDistance
    let travelTime: TimeInterval
}

private let estimateFormatter: MeasurementFormatter = {
    let formatter = MeasurementFormatter()
    formatter.unitOptions = .naturalScale
    formatter.unitStyle = .medium
    return formatter
}()

private let durationFormatter: DateComponentsFormatter = {
    let formatter = DateComponentsFormatter()
    formatter.allowedUnits = [.hour, .minute]
    formatter.unitsStyle = .abbreviated
    return formatter
}()

/// Custom Apple Plans style header for itinerary route editor
struct ItineraryHeader: View {
    @Binding var stops: [RouteStop]
    @Binding var profile: String
    let legEstimates: [UUID: LegEstimate]
    var onAddStop: () -> Void

    @State private var draggingStopID: UUID?

    var body: some View {
        VStack(spacing: 8) {
            LazyVStack(alignment: .leading, spacing: 0) {
                startingPointRow
                
                ForEach(Array(stops.enumerated()), id: \.element.id) { index, stop in
                    VStack(alignment: .leading, spacing: 0) {
                        routeLegConnector(for: stop)
                        
                        stopRow(index: index, stop: stop)
                    }
                    .onDrag {
                        draggingStopID = stop.id
                        return NSItemProvider(object: stop.id.uuidString as NSString)
                    }
                    .onDrop(of: [.text], delegate: StopDropDelegate(
                        target: stop,
                        stops: $stops,
                        draggingStopID: $draggingStopID
                    ))
                }
            }
            .padding(.horizontal, 4)

            HStack(spacing: 12) {
                Button(action: onAddStop) {
                    HStack {
                        Image(systemName: "plus.circle.fill")
                            .font(.system(size: 14, weight: .semibold))
                        Text("Ajouter un arrêt")
                            .font(.subheadline.weight(.semibold))
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Color(.secondarySystemFill), in: Capsule())
                }
                .buttonStyle(.plain)

                Spacer()

                Picker("Profil", selection: $profile) {
                    Image(systemName: "car.fill").tag("driving")
                    Image(systemName: "figure.walk").tag("walking")
                }
                .pickerStyle(.segmented)
                .frame(width: 100)
            }
            .padding(.top, 4)
            .padding(.horizontal, 4)
        }
    }

    private var startingPointRow: some View {
        HStack(spacing: 10) {
            Image(systemName: "location.fill")
                .font(.system(size: 10, weight: .bold))
                .frame(width: 22, height: 22)
                .background(Color.blue, in: Circle())
                .foregroundStyle(.white)

            Text("Ma position actuelle")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Spacer()
        }
        .padding(.vertical, 6)
    }

    @ViewBuilder
    private func routeLegConnector(for stop: RouteStop) -> some View {
        HStack(spacing: 10) {
            VStack(spacing: 3) {
                ForEach(0..<3) { _ in
                    Circle()
                        .fill(.tertiary)
                        .frame(width: 3, height: 3)
                }
            }
            .frame(width: 22)

            if let estimate = legEstimates[stop.id] {
                let distance = Measurement(value: estimate.distanceMeters, unit: UnitLength.meters)
                let duration = durationFormatter.string(from: estimate.travelTime) ?? ""
                
                Text("\(duration) (\(estimateFormatter.string(from: distance)))")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(Color(.systemFill), in: Capsule())
            } else {
                Spacer()
            }
        }
        .padding(.vertical, 1)
    }

    @ViewBuilder
    private func stopBadge(index: Int) -> some View {
        if index == stops.count - 1 {
            Image(systemName: "mappin.and.ellipse")
                .font(.system(size: 11, weight: .bold))
                .frame(width: 22, height: 22)
                .background(Color.red, in: Circle())
                .foregroundColor(.white)
        } else {
            let letterCode = 65 + index
            let letter = String(Character(UnicodeScalar(letterCode)!))
            Text(letter)
                .font(.caption.bold())
                .frame(width: 22, height: 22)
                .background(Color(.systemGray4), in: Circle())
                .foregroundColor(.primary)
        }
    }

    @ViewBuilder
    private func stopRow(index: Int, stop: RouteStop) -> some View {
        HStack(spacing: 10) {
            stopBadge(index: index)

            Text(stop.name)
                .font(.subheadline)
                .lineLimit(1)

            Spacer()

            Image(systemName: "line.3.horizontal")
                .foregroundStyle(.tertiary)
                .frame(width: 44, height: 34)
                .accessibilityHidden(true)

            Button(role: .destructive) {
                withAnimation {
                    stops.removeAll { $0.id == stop.id }
                }
            } label: {
                Image(systemName: "trash")
                    .foregroundStyle(.red)
                    .frame(width: 34, height: 34)
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }
}

/// Custom Apple Plans style options sheet for itinerary simulator details
struct ItineraryOptions: View {
    let stops: [RouteStop]
    @Binding var speed: Double
    let profile: String
    let totalEstimate: LegEstimate?
    var onLaunch: () -> Void

    @State private var showGpxExporter = false
    @State private var gpxExportError: String?
    @State private var launchFeedback = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            routePreviewCard

            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Vitesse de simulation")
                        .font(.subheadline.weight(.medium))
                    Spacer()
                    Text("\(Int(speed)) km/h")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
                
                Slider(value: $speed, in: 5...130, step: 5)
                    .accessibilityValue("\(Int(speed)) kilomètres heure")
            }
            .padding(.horizontal, 4)

            HStack(spacing: 12) {
                Button {
                    showGpxExporter = true
                } label: {
                    Label("Exporter GPX", systemImage: "square.and.arrow.up")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.glass)
                .disabled(stops.isEmpty)

                Button(action: {
                    launchFeedback += 1
                    onLaunch()
                }) {
                    Text("Lancer l'itinéraire")
                        .font(.subheadline.weight(.bold))
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.glassProminent)
                .tint(.accentColor)
                .disabled(stops.isEmpty)
            }
            
            if let gpxExportError {
                Text(gpxExportError)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .padding(.horizontal, 4)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .sensoryFeedback(.success, trigger: launchFeedback)
        .fileExporter(
            isPresented: $showGpxExporter,
            document: GPXFile(content: GPX.document(name: "Itinéraire GPS-Mock", points: stops.map(\.coordinate))),
            contentType: .gpx,
            defaultFilename: "gpsmock_route"
        ) { result in
            if case .failure(let error) = result {
                gpxExportError = error.localizedDescription
            }
        }
    }

    @ViewBuilder
    private var routePreviewCard: some View {
        if let destination = stops.last {
            HStack(spacing: 12) {
                Image(systemName: profile == "walking" ? "figure.walk.circle.fill" : "car.circle.fill")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(Color.accentColor)
                    .frame(width: 42, height: 42)

                VStack(alignment: .leading, spacing: 3) {
                    Text("Vers \(destination.name)")
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                    Text(routePreviewSubtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer()
            }
            .padding(14)
            .frame(maxWidth: .infinity, minHeight: 68, alignment: .leading)
            .background(Color(.secondarySystemFill), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
    }

    private var routePreviewSubtitle: String {
        var parts: [String] = []
        if let totalEstimate = totalEstimate {
            let distance = Measurement(value: totalEstimate.distanceMeters, unit: UnitLength.meters)
            parts.append(estimateFormatter.string(from: distance))
            if let duration = durationFormatter.string(from: totalEstimate.travelTime), !duration.isEmpty {
                parts.append(duration)
            }
        }
        parts.append(profile == "walking" ? "Marche" : "Voiture")
        parts.append("\(Int(speed)) km/h")
        return parts.joined(separator: " · ")
    }
}

/// Drop delegate that reorders `stops` as a dragged row crosses another row's bounds.
private struct StopDropDelegate: DropDelegate {
    let target: RouteStop
    @Binding var stops: [RouteStop]
    @Binding var draggingStopID: UUID?

    func dropEntered(info: DropInfo) {
        guard let draggingStopID, draggingStopID != target.id,
              let fromIndex = stops.firstIndex(where: { $0.id == draggingStopID }),
              let toIndex = stops.firstIndex(where: { $0.id == target.id }) else { return }
        withAnimation {
            stops.move(fromOffsets: IndexSet(integer: fromIndex), toOffset: toIndex > fromIndex ? toIndex + 1 : toIndex)
        }
    }

    func performDrop(info: DropInfo) -> Bool {
        draggingStopID = nil
        return true
    }

    func dropUpdated(info: DropInfo) -> DropProposal? {
        DropProposal(operation: .move)
    }
}
