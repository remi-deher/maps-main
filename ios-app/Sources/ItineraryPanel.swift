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

/// Floating glass card listing the stops of an itinerary being built — à la
/// Plans' multi-stop directions editor. Stops live in a List so SwiftUI's
/// native long-press drag-to-reorder works without a separate drag handle.
struct ItineraryPanel: View {
    @Binding var stops: [RouteStop]
    @Binding var speed: Double
    @Binding var profile: String
    let legEstimates: [UUID: LegEstimate]
    var onAddStop: () -> Void
    var onLaunch: () -> Void
    var onCancel: () -> Void

    @State private var launchFeedback = 0
    @State private var draggingStopID: UUID?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Itinéraire (\(stops.count) étape\(stops.count > 1 ? "s" : ""))")
                    .font(.headline)
                Spacer()
                Button(action: onCancel) {
                    Label("Annuler l'itinéraire", systemImage: "xmark.circle.fill")
                        .labelStyle(.iconOnly)
                        .foregroundStyle(.secondary)
                        .font(.title3)
                        .frame(width: 44, height: 44)
                }
            }

            // Plain LazyVStack instead of a List, so this doesn't nest a
            // second independently-scrolling list inside BottomSheet's outer
            // ScrollView (the source of the drag-to-reorder gesture conflicts
            // and the brittle `rowHeight * count` sizing it replaced).
            LazyVStack(spacing: 0) {
                ForEach(Array(stops.enumerated()), id: \.element.id) { index, stop in
                    stopRow(index: index, stop: stop)
                        .onDrag {
                            draggingStopID = stop.id
                            return NSItemProvider(object: stop.id.uuidString as NSString)
                        }
                        .onDrop(of: [.text], delegate: StopDropDelegate(
                            target: stop,
                            stops: $stops,
                            draggingStopID: $draggingStopID
                        ))
                    if index < stops.count - 1 {
                        Divider()
                    }
                }
            }

            Button(action: onAddStop) {
                HStack {
                    Image(systemName: "plus.circle.fill")
                    Text("Ajouter un arrêt")
                }
                .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.glass)

            HStack {
                Text("Vitesse")
                Spacer()
                Text("\(Int(speed)) km/h")
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            .font(.subheadline)
            Slider(value: $speed, in: 5...130, step: 5) {
                Text("Vitesse")
            }
            .accessibilityValue("\(Int(speed)) kilomètres heure")

            Picker("Profil", selection: $profile) {
                Label("Voiture", systemImage: "car.fill").tag("driving")
                Label("Marche", systemImage: "figure.walk").tag("walking")
            }
            .pickerStyle(.segmented)

            Button("Lancer l'itinéraire") {
                launchFeedback += 1
                onLaunch()
            }
            .buttonStyle(.glassProminent)
            .tint(.accentColor)
            .frame(maxWidth: .infinity, minHeight: 44)
            .disabled(stops.isEmpty)
        }
        .padding(18)
        .adaptiveGlassEffect(in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .padding(.horizontal, 16)
        .sensoryFeedback(.success, trigger: launchFeedback)
    }

    @ViewBuilder
    private func stopRow(index: Int, stop: RouteStop) -> some View {
        HStack(spacing: 10) {
            Text("\(index + 1)")
                .font(.caption.bold())
                .frame(width: 22, height: 22)
                .background(.accentColor, in: Circle())
                .foregroundStyle(.white)

            VStack(alignment: .leading, spacing: 2) {
                Text(stop.name).lineLimit(1)
                if let estimate = legEstimates[stop.id] {
                    let distance = Measurement(value: estimate.distanceMeters, unit: UnitLength.meters)
                    let duration = durationFormatter.string(from: estimate.travelTime) ?? ""
                    Text("\(estimateFormatter.string(from: distance)) · \(duration)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            Image(systemName: "line.3.horizontal")
                .foregroundStyle(.tertiary)
                .frame(width: 44, height: 44)

            Button(role: .destructive) {
                stops.removeAll { $0.id == stop.id }
            } label: {
                Label("Supprimer l'étape", systemImage: "trash")
                    .labelStyle(.iconOnly)
                    .foregroundStyle(.red)
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 8)
        .contentShape(Rectangle())
    }
}

/// Drop delegate that reorders `stops` as a dragged row crosses another row's
/// bounds — the non-List equivalent of `.onMove`, needed now that the panel
/// uses a plain LazyVStack (see §3.12 of docs/UI_UX_BASELINE.md).
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
