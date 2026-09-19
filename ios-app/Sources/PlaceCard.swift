import SwiftUI
import MapKit
import CoreLocation

// A point selected on the map or from search — name/subtitle are nil for a
// raw map tap (no geocoded name available), populated for a search result.
struct SelectedPlace: Equatable {
    let coordinate: CLLocationCoordinate2D
    let title: String
    let subtitle: String?
    // Catégorie MapKit du lieu, quand il vient d'une recherche ou d'un POI de
    // la carte. Sert au libellé « Restaurant · à 2,3 km » et à la couleur de
    // l'épingle — Plans ne pose pas des repères rouges identiques partout.
    // Voir PointOfInterestStyle.swift.
    var category: MKPointOfInterestCategory?

    // Stable id for map ForEach / dedup, derived from the coordinate.
    var mapID: String {
        String(format: "%.6f,%.6f", coordinate.latitude, coordinate.longitude)
    }

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.coordinate.latitude == rhs.coordinate.latitude
            && lhs.coordinate.longitude == rhs.coordinate.longitude
            && lhs.title == rhs.title
    }
}

// Fiche lieu, calquée sur la grammaire de Plans :
//
//   [titre — porté par le header de la sheet]
//   Restaurant · à 2,3 km                    (2 sur 7  ‹ › )
//   ⊙ Positionner  ⊙ Itinéraire  ⊙ Étape  ⊙ Favori  ⊙ Partager
//   [aperçu Look Around]
//   [infos en liste groupée]
//
// Le titre et la croix de fermeture vivent dans `BottomSheetHeaderView`, qui
// bascule en barre de lieu dès qu'un lieu est sélectionné — comme Plans, où le
// champ de recherche cède la place au nom du lieu. Les deux rangées de
// capsules pleine largeur de la version précédente sont devenues une rangée
// de boutons ronds, la signature visuelle de la fiche Plans.
// Voir docs/UI_UX_AUDIT_IOS_2026-09.md.
struct PlaceCard: View {
    let place: SelectedPlace
    let isFavorite: Bool
    // Origin for the "à X km" line (simulated or real position). nil hides it.
    var referenceCoordinate: CLLocationCoordinate2D?
    // Rang du lieu dans un jeu de résultats multiples, pour naviguer de l'un à
    // l'autre sans revenir à la liste (Plans laisse balayer les résultats).
    var resultPosition: Int?
    var resultCount: Int = 0
    var onSelectPreviousResult: () -> Void = {}
    var onSelectNextResult: () -> Void = {}
    var onTeleport: () -> Void
    var onRoute: () -> Void
    var onAddStop: () -> Void
    var onFavorite: () -> Void
    var onRemoveFavorite: () -> Void
    var onCopyCoordinates: () -> Void

    @State private var actionFeedback = 0
    // Confirmation éphémère de la copie : l'action était muette (audit P2-8).
    @State private var showsCopyConfirmation = false
    // Look Around coverage for the selected place, fetched lazily. Nil when
    // the area has no Street-level imagery (oceans, remote spots) — the
    // preview is simply omitted then, never an error (§2 Plans parity).
    @State private var lookAroundScene: MKLookAroundScene?
    @State private var showsLookAroundViewer = false
    @State private var placemark: CLPlacemark?

    // Sizes that scale with Dynamic Type (§ audit #21).
    @ScaledMetric(relativeTo: .body) private var detailIconSize: CGFloat = 34
    @ScaledMetric(relativeTo: .body) private var actionCircleSize: CGFloat = 52
    @ScaledMetric(relativeTo: .body) private var previewHeight: CGFloat = 168

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            identityLine
            actionRow

            if let lookAroundScene {
                lookAroundPreview(lookAroundScene)
            }

            placeDetailsCard
            copyConfirmation
        }
        .padding(18)
        .sheetCardBackground(in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .padding(.horizontal, 16)
        .sensoryFeedback(.success, trigger: actionFeedback)
        .lookAroundViewer(isPresented: $showsLookAroundViewer, initialScene: lookAroundScene)
        // Re-fetch whenever the selected coordinate changes. Keyed on a
        // lat,lon string because CLLocationCoordinate2D isn't Hashable.
        .task(id: "\(place.coordinate.latitude),\(place.coordinate.longitude)") {
            lookAroundScene = try? await MKLookAroundSceneRequest(coordinate: place.coordinate).scene
            let location = CLLocation(latitude: place.coordinate.latitude, longitude: place.coordinate.longitude)
            let placemarks = try? await CLGeocoder().reverseGeocodeLocation(location)
            placemark = placemarks?.first
        }
    }

    // « Restaurant · à 2,3 km », plus le compteur de résultats quand la
    // recherche en a rapporté plusieurs.
    private var identityLine: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(identityText)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.secondary)
                .lineLimit(1)

            Spacer(minLength: 8)

            if resultCount > 1, let resultPosition {
                resultPager(position: resultPosition)
            }
        }
    }

    private var identityText: String {
        var parts: [String] = []
        if let category = PointOfInterestStyle.label(for: place.category) {
            parts.append(category)
        }
        if let distanceText {
            parts.append(distanceText)
        }
        if parts.isEmpty, let subtitle = place.subtitle, !subtitle.isEmpty {
            return subtitle
        }
        return parts.joined(separator: " · ")
    }

    private func resultPager(position: Int) -> some View {
        HStack(spacing: 4) {
            Button(action: onSelectPreviousResult) {
                Image(systemName: "chevron.left")
                    .font(.footnote.weight(.semibold))
                    .frame(width: 34, height: 34)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(position <= 1)
            .accessibilityLabel("Résultat précédent")

            Text("\(position) sur \(resultCount)")
                .font(.caption.weight(.medium))
                .monospacedDigit()
                .foregroundStyle(.secondary)

            Button(action: onSelectNextResult) {
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .frame(width: 34, height: 34)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(position >= resultCount)
            .accessibilityLabel("Résultat suivant")
        }
    }

    // La rangée d'actions rondes de Plans. Horizontalement scrollable : à fort
    // Dynamic Type les libellés s'élargissent au lieu d'être tronqués.
    private var actionRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 14) {
                actionButton(
                    "Positionner",
                    systemImage: "location.fill",
                    isProminent: true,
                    action: { trigger(onTeleport) }
                )
                actionButton(
                    "Itinéraire",
                    systemImage: "arrow.triangle.turn.up.right.diamond.fill",
                    action: { trigger(onRoute) }
                )
                actionButton(
                    "Étape",
                    systemImage: "plus",
                    action: { trigger(onAddStop) }
                )
                actionButton(
                    isFavorite ? "Retirer" : "Favori",
                    systemImage: isFavorite ? "star.fill" : "star",
                    action: { trigger(isFavorite ? onRemoveFavorite : onFavorite) }
                )
                shareButton
                actionButton(
                    "Copier",
                    systemImage: "doc.on.doc",
                    action: {
                        trigger(onCopyCoordinates)
                        confirmCopy()
                    }
                )
            }
            .padding(.horizontal, 2)
            .padding(.bottom, 2)
        }
    }

    private func actionButton(
        _ title: String,
        systemImage: String,
        isProminent: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            actionLabel(title, systemImage: systemImage, isProminent: isProminent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
    }

    private var shareButton: some View {
        ShareLink(item: shareURL, subject: Text(place.title), message: Text(shareMessage)) {
            actionLabel("Partager", systemImage: "square.and.arrow.up", isProminent: false)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Partager ce lieu")
    }

    private func actionLabel(_ title: String, systemImage: String, isProminent: Bool) -> some View {
        VStack(spacing: 6) {
            Image(systemName: systemImage)
                .font(.title3.weight(.semibold))
                .foregroundStyle(isProminent ? Color.white : Color.accentColor)
                .frame(width: actionCircleSize, height: actionCircleSize)
                .background(
                    isProminent ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(Color(.tertiarySystemFill)),
                    in: Circle()
                )

            Text(title)
                .font(.caption)
                .foregroundStyle(.primary)
                .lineLimit(1)
        }
        .frame(minWidth: actionCircleSize + 8)
        .contentShape(Rectangle())
    }

    // Lien Plans standard : ouvrable par n'importe quel destinataire, et bien
    // plus utile qu'un couple de coordonnées brut dans un message.
    private var shareURL: URL {
        let latitude = place.coordinate.latitude
        let longitude = place.coordinate.longitude
        var components = URLComponents(string: "https://maps.apple.com/")
        components?.queryItems = [
            URLQueryItem(name: "ll", value: "\(latitude),\(longitude)"),
            URLQueryItem(name: "q", value: place.title)
        ]
        return components?.url ?? URL(string: "https://maps.apple.com/")!
    }

    private var shareMessage: String {
        String(format: "%@ — %.6f, %.6f", place.title, place.coordinate.latitude, place.coordinate.longitude)
    }

    private func lookAroundPreview(_ scene: MKLookAroundScene) -> some View {
        Button {
            showsLookAroundViewer = true
        } label: {
            LookAroundPreview(initialScene: scene)
                .frame(height: previewHeight)
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                .overlay(alignment: .topTrailing) {
                    Image(systemName: "arrow.up.left.and.arrow.down.right")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.white)
                        .padding(7)
                        .background(.black.opacity(0.45), in: Circle())
                        .padding(10)
                        .accessibilityHidden(true)
                }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Aperçu Look Around de \(place.title), ouvrir en plein écran")
    }

    private var placeDetailsCard: some View {
        VStack(spacing: 0) {
            if let address = addressText {
                detailRow(title: "Adresse", value: address, icon: "mappin.and.ellipse")
                Divider().padding(.leading, 58)
            }

            detailRow(title: "Coordonnées GPS", value: coordinateText, icon: "location.north.line.fill")

            if let locality = localityText {
                Divider().padding(.leading, 58)
                detailRow(title: "Zone", value: locality, icon: "map.fill")
            }
        }
        .sheetInnerBackground(in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    // Confirmation de copie : dans le flux de la carte plutôt qu'en overlay
    // décalé, pour ne pas déborder hors de la sheet.
    @ViewBuilder
    private var copyConfirmation: some View {
        if showsCopyConfirmation {
            Label("Coordonnées copiées", systemImage: "checkmark.circle.fill")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(Color(.tertiarySystemFill), in: Capsule())
                .frame(maxWidth: .infinity, alignment: .center)
                .transition(.opacity)
        }
    }

    private func confirmCopy() {
        withAnimation(.snappy(duration: 0.2)) { showsCopyConfirmation = true }
        Task {
            try? await Task.sleep(for: .seconds(2))
            withAnimation(.snappy(duration: 0.2)) { showsCopyConfirmation = false }
        }
    }

    private func detailRow(title: String, value: String, icon: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.accentColor)
                .frame(width: detailIconSize, height: detailIconSize)
                .background(Color(.secondarySystemFill), in: Circle())

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.body)
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 11)
    }

    private var addressText: String? {
        let lines = [
            thoroughfareText,
            cityText,
            placemark?.country
        ]
        .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }

        if !lines.isEmpty {
            return lines.joined(separator: "\n")
        }

        if let subtitle = place.subtitle, !subtitle.isEmpty {
            return subtitle
        }

        return nil
    }

    private var thoroughfareText: String? {
        guard let placemark else { return nil }
        let parts = [placemark.subThoroughfare, placemark.thoroughfare]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " ")
    }

    private var cityText: String? {
        guard let placemark else { return nil }
        let parts = [placemark.postalCode, placemark.locality]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
        return parts.isEmpty ? placemark.administrativeArea : parts.joined(separator: " ")
    }

    private var localityText: String? {
        let parts = [placemark?.subLocality, placemark?.administrativeArea]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: ", ")
    }

    private var coordinateText: String {
        String(format: "%.6f, %.6f", place.coordinate.latitude, place.coordinate.longitude)
    }

    // Great-circle distance from the reference position to the place, à la
    // Plans' "à 2,3 km" under a result title.
    private var distanceText: String? {
        guard let referenceCoordinate else { return nil }
        let origin = CLLocation(latitude: referenceCoordinate.latitude, longitude: referenceCoordinate.longitude)
        let target = CLLocation(latitude: place.coordinate.latitude, longitude: place.coordinate.longitude)
        let meters = origin.distance(from: target)
        guard meters > 1 else { return nil }
        let formatter = MeasurementFormatter()
        formatter.unitOptions = .naturalScale
        formatter.unitStyle = .medium
        let measurement = Measurement(value: meters, unit: UnitLength.meters)
        return "à \(formatter.string(from: measurement))"
    }

    private func trigger(_ action: () -> Void) {
        actionFeedback += 1
        action()
    }
}
