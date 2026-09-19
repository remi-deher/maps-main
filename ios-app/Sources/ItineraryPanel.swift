import SwiftUI
import CoreLocation
import UniformTypeIdentifiers

// Drive-time/distance for the leg ending at a given stop, computed via
// MKDirections (keyed by the destination RouteStop's id) — mirrors the ETA
// Plans shows under each leg of a multi-stop trip.
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

// Custom Apple Plans style header for itinerary route editor
struct ItineraryHeader: View {
    @Binding var stops: [RouteStop]
    @Binding var profile: String
    let legEstimates: [UUID: LegEstimate]
    var onAddStop: () -> Void

    @State private var draggingStopID: UUID?

    // Pastilles d'étape, cible tactile et taille de poignée : mises à l'échelle
    // du Dynamic Type au lieu d'être figées. C'était la dernière vue à utiliser
    // des `.font(.system(size:))` en dur et des frames constants — à l'échelle
    // AX5 le texte débordait de sa pastille (audit P1-3 et P1-4).
    @ScaledMetric(relativeTo: .caption) private var badgeSize: CGFloat = 24
    @ScaledMetric(relativeTo: .body) private var controlSize: CGFloat = 44

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
                            .font(.subheadline.weight(.semibold))
                        Text("Ajouter un arrêt")
                            .font(.subheadline.weight(.semibold))
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Color(.secondarySystemFill), in: Capsule())
                }
                .buttonStyle(.plain)

                Spacer()

                // `Label` plutôt qu'une `Image` nue : l'icône seule s'affiche,
                // mais le texte reste pour VoiceOver (audit P1-5). Largeur
                // minimale plutôt que figée, pour ne pas tronquer en Dynamic
                // Type élevé.
                Picker("Profil", selection: $profile) {
                    Label("Voiture", systemImage: "car.fill")
                        .labelStyle(.iconOnly)
                        .tag("driving")
                    Label("À pied", systemImage: "figure.walk")
                        .labelStyle(.iconOnly)
                        .tag("walking")
                }
                .pickerStyle(.segmented)
                .frame(minWidth: 100)
                .fixedSize()
            }
            .padding(.top, 4)
            .padding(.horizontal, 4)
        }
    }

    private var startingPointRow: some View {
        HStack(spacing: 10) {
            Image(systemName: "location.fill")
                .font(.caption2.weight(.bold))
                .frame(width: badgeSize, height: badgeSize)
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
            .frame(width: badgeSize)

            if let estimate = legEstimates[stop.id] {
                let distance = Measurement(value: estimate.distanceMeters, unit: UnitLength.meters)
                let duration = durationFormatter.string(from: estimate.travelTime) ?? ""

                Text("\(duration) (\(estimateFormatter.string(from: distance)))")
                    .font(.caption2.weight(.medium))
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
                .font(.caption2.weight(.bold))
                .frame(width: badgeSize, height: badgeSize)
                .background(Color.red, in: Circle())
                .foregroundStyle(.white)
        } else {
            let letterCode = 65 + index
            let letter = String(Character(UnicodeScalar(letterCode)!))
            Text(letter)
                .font(.caption.bold())
                .frame(width: badgeSize, height: badgeSize)
                .background(Color(.systemGray4), in: Circle())
                .foregroundStyle(.primary)
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
                .frame(width: controlSize, height: controlSize)
                .accessibilityHidden(true)

            Button(role: .destructive) {
                removeStop(stop)
            } label: {
                Image(systemName: "trash")
                    .foregroundStyle(.red)
                    .frame(width: controlSize, height: controlSize)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Supprimer \(stop.name)")
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        // La réorganisation se fait au glisser-déposer, inaccessible en
        // VoiceOver / Contrôle de sélection : ces actions offrent le même
        // résultat au rotor (audit P1-6).
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel(index: index, stop: stop))
        .accessibilityActions {
            if index > 0 {
                Button("Monter dans l'itinéraire") { move(stop, by: -1) }
            }
            if index < stops.count - 1 {
                Button("Descendre dans l'itinéraire") { move(stop, by: 1) }
            }
            Button("Supprimer l'étape", role: .destructive) { removeStop(stop) }
        }
    }

    private func accessibilityLabel(index: Int, stop: RouteStop) -> String {
        "Étape \(index + 1) sur \(stops.count) : \(stop.name)"
    }

    private func removeStop(_ stop: RouteStop) {
        withAnimation {
            stops.removeAll { $0.id == stop.id }
        }
    }

    private func move(_ stop: RouteStop, by offset: Int) {
        guard let source = stops.firstIndex(where: { $0.id == stop.id }) else { return }
        let target = source + offset
        guard stops.indices.contains(target) else { return }
        withAnimation {
            stops.move(
                fromOffsets: IndexSet(integer: source),
                toOffset: target > source ? target + 1 : target
            )
        }
    }
}

// Custom Apple Plans style options sheet for itinerary simulator details
struct ItineraryOptions: View {
    let stops: [RouteStop]
    @Binding var speed: Double
    let profile: String
    let totalEstimate: LegEstimate?
    var alternatives: [RouteAlternative] = []
    var selectedAlternativeIndex: Int = 0
    var onSelectAlternative: (Int) -> Void = { _ in }
    var onLaunch: () -> Void

    @State private var showGpxExporter = false
    @State private var gpxExportError: String?
    @State private var launchFeedback = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            routePreviewCard
            alternativesSection

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
                .buttonStyle(.bordered)
                .disabled(stops.isEmpty)

                Button {
                    launchFeedback += 1
                    onLaunch()
                } label: {
                    Text("Lancer l'itinéraire")
                        .font(.subheadline.weight(.bold))
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
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
            defaultFilename: "gpsmock_route",
            onCompletion: { result in
                if case .failure(let error) = result {
                    gpxExportError = error.localizedDescription
                }
            }
        )
    }

    // Variantes de trajet, comme Plans les empile sous la destination : la plus
    // rapide en tête, les autres avec leur surcoût en minutes. Choisir n'est pas
    // décoratif — un point de passage est injecté au lancement pour que la
    // simulation emprunte réellement la variante retenue
    // (MapCoordinator+RouteAlternatives.swift).
    @ViewBuilder
    private var alternativesSection: some View {
        if alternatives.count > 1 {
            VStack(alignment: .leading, spacing: 8) {
                Text("Trajets proposés")
                    .font(.subheadline.weight(.semibold))
                    .padding(.horizontal, 4)

                VStack(spacing: 0) {
                    ForEach(alternatives) { alternative in
                        alternativeRow(alternative)
                        if alternative.index != alternatives.count - 1 {
                            Divider().padding(.leading, 46)
                        }
                    }
                }
                .sheetInnerBackground(in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
        }
    }

    private func alternativeRow(_ alternative: RouteAlternative) -> some View {
        let isSelected = alternative.index == selectedAlternativeIndex
        return Button {
            onSelectAlternative(alternative.index)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(isSelected ? Color.accentColor : Color.secondary)
                    .frame(width: 34, height: 34)

                VStack(alignment: .leading, spacing: 2) {
                    Text(alternativeTitle(alternative))
                        .font(.subheadline.weight(isSelected ? .semibold : .regular))
                        .foregroundStyle(.primary)
                    Text(alternativeDetail(alternative))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 8)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(minHeight: 56)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }

    private func alternativeTitle(_ alternative: RouteAlternative) -> String {
        if alternative.isFastest {
            return "Le plus rapide"
        }
        let extraMinutes = max(Int((alternative.extraSeconds / 60).rounded()), 1)
        return "+\(extraMinutes) min"
    }

    private func alternativeDetail(_ alternative: RouteAlternative) -> String {
        let distance = Measurement(value: alternative.route.distanceMeters, unit: UnitLength.meters)
        var parts = [estimateFormatter.string(from: distance)]
        if let duration = durationFormatter.string(from: alternative.route.durationSeconds), !duration.isEmpty {
            parts.insert(duration, at: 0)
        }
        return parts.joined(separator: " · ")
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
            .sheetCardBackground(in: RoundedRectangle(cornerRadius: 18, style: .continuous))
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

// Drop delegate that reorders `stops` as a dragged row crosses another row's bounds.
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
