import SwiftUI
import CoreLocation

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

    private var rowHeight: CGFloat { 52 }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Itinéraire (\(stops.count) étape\(stops.count > 1 ? "s" : ""))")
                    .font(.headline)
                Spacer()
                Button(action: onCancel) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                }
            }

            List {
                ForEach(Array(stops.enumerated()), id: \.element.id) { index, stop in
                    HStack(spacing: 10) {
                        Text("\(index + 1)")
                            .font(.caption.bold())
                            .frame(width: 22, height: 22)
                            .background(.indigo, in: Circle())
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

                        Button(role: .destructive) {
                            stops.remove(at: index)
                        } label: {
                            Image(systemName: "trash")
                                .foregroundStyle(.red)
                        }
                        .buttonStyle(.plain)
                    }
                    .listRowBackground(Color.clear)
                    .listRowSeparator(index == stops.count - 1 ? .hidden : .visible)
                }
                .onMove { source, destination in
                    stops.move(fromOffsets: source, toOffset: destination)
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .scrollDisabled(true)
            .frame(height: rowHeight * CGFloat(stops.count))

            Button(action: onAddStop) {
                HStack {
                    Image(systemName: "plus.circle.fill")
                    Text("Ajouter un arrêt")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.glass)

            HStack {
                Text("Vitesse")
                Stepper("\(Int(speed)) km/h", value: $speed, in: 5...130, step: 5)
            }
            .font(.subheadline)

            Picker("Profil", selection: $profile) {
                Text("Voiture").tag("driving")
                Text("Marche").tag("walking")
            }
            .pickerStyle(.segmented)

            Button("Lancer l'itinéraire") {
                launchFeedback += 1
                onLaunch()
            }
            .buttonStyle(.glassProminent)
            .tint(.indigo)
            .frame(maxWidth: .infinity)
            .disabled(stops.isEmpty)
        }
        .padding(18)
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .padding(.horizontal, 16)
        .sensoryFeedback(.success, trigger: launchFeedback)
    }
}
