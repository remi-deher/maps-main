import SwiftUI

private struct ScrollOffsetKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

struct BottomSheet: View {
    // Hauteur du détent replié, constante.
    //
    // Elle était auparavant mesurée sur le header par une `PreferenceKey`, puis
    // réinjectée dans `presentationDetents` — une boucle de layout dont le
    // résultat changeait avec la nature du header (champ de recherche ~66 pt,
    // barre de lieu ~56 pt) : sélectionner un lieu faisait donc bouger le
    // détent replié sous le doigt. Plans a une hauteur fixe.
    //
    // 104 pt laisse de la marge au header même à fort Dynamic Type ; au-delà de
    // l'échelle AX3 il peut se retrouver légèrement rogné au détent replié,
    // compromis assumé contre la suppression de l'aller-retour de mesure.
    static let collapsedDetentHeight: CGFloat = 104

    let search: BottomSheetSearchContext
    let itinerary: BottomSheetItineraryContext
    let library: BottomSheetLibraryContext
    let place: BottomSheetPlaceContext
    let patrol: PatrolControls
    let gpx: GpxImport
    let simulation: BottomSheetSimulationContext
    let chrome: BottomSheetChromeContext
    let status: BottomSheetStatusContext

    @Binding private var sheetDetent: SheetDetent

    // Le contenu est-il descendu sous le header ? Sert uniquement au filet de
    // séparation ci-dessous, d'où l'état local : la valeur était auparavant
    // remontée jusqu'à `MapCoordinator.sheetScrollOffset` — sur trois couches,
    // à chaque frame de défilement — et n'était lue nulle part. La garder
    // locale évite aussi de réévaluer la sheet entière pendant qu'on scrolle.
    @State private var isContentScrolled = false

    private var isCollapsed: Bool {
        sheetDetent == .collapsed
    }

    private var hasActiveRouteControls: Bool {
        itinerary.activeRoute != nil
    }

    init(
        search: BottomSheetSearchContext,
        itinerary: BottomSheetItineraryContext,
        library: BottomSheetLibraryContext,
        place: BottomSheetPlaceContext,
        patrol: PatrolControls,
        gpx: GpxImport,
        simulation: BottomSheetSimulationContext,
        chrome: BottomSheetChromeContext,
        status: BottomSheetStatusContext,
        presentation: BottomSheetPresentationContext
    ) {
        self.search = search
        self.itinerary = itinerary
        self.library = library
        self.place = place
        self.patrol = patrol
        self.gpx = gpx
        self.simulation = simulation
        self.chrome = chrome
        self.status = status
        self._sheetDetent = presentation.sheetDetent
    }

    var body: some View {
        VStack(spacing: 0) {
            BottomSheetHeaderView(
                search: search,
                itinerary: itinerary,
                place: place,
                simulation: simulation,
                chrome: chrome,
                status: status,
                isCollapsed: isCollapsed
            )
            // Filet de séparation quand le contenu passe sous le header, comme
            // Plans : sans lui, les lignes qui défilent semblent sortir de
            // nulle part sous le champ de recherche.
            .overlay(alignment: .bottom) {
                Divider()
                    .opacity(isContentScrolled ? 1 : 0)
            }

            if !isCollapsed {
                scrollableContent
                    .padding(.top, 10)
                    .transition(.opacity)
            }

            if !isCollapsed, hasActiveRouteControls {
                BottomSheetActiveRouteControlDockView(
                    simulationState: simulation.state,
                    onResumeRoute: simulation.onResumeRoute,
                    onPauseRoute: simulation.onPauseRoute,
                    onStopRoute: simulation.onStopRoute,
                    onRecenterActiveRoute: itinerary.onRecenterActiveRoute,
                    onShowActiveRouteDetails: itinerary.onShowActiveRouteDetails,
                    onOpenSettings: chrome.onOpenSettings
                )
                .padding(.top, 10)
                .padding(.bottom, 8)
            }
        }
    }

    private var scrollableContent: some View {
        ScrollView {
            BottomSheetContentView(
                search: search,
                itinerary: itinerary,
                library: library,
                place: place,
                patrol: patrol,
                gpx: gpx,
                simulation: simulation,
                chrome: chrome,
                status: status
            )
            .padding(.bottom, hasActiveRouteControls ? 8 : 24)
            .background(
                GeometryReader { proxy in
                    let offsetY = proxy.frame(in: .named("scroll")).minY
                    Color.clear.preference(key: ScrollOffsetKey.self, value: offsetY)
                }
            )
        }
        .coordinateSpace(name: "scroll")
        // Scrollable dès que la sheet est ouverte, pas seulement au détent
        // `large` : au détent `medium` (43 % de l'écran) une PlaceCard avec
        // aperçu Look Around, ou une liste de plus de cinq suggestions,
        // dépasse la hauteur disponible — le verrouiller rendait le bas du
        // contenu définitivement inatteignable. Plans scrolle à tous ses
        // détents. Voir docs/UI_UX_AUDIT_IOS_2026-09.md, P0-3.
        .scrollDisabled(isCollapsed)
        .scrollDismissesKeyboard(.interactively)
        .onPreferenceChange(ScrollOffsetKey.self) { value in
            // Ne réécrit l'état que lorsque le booléen bascule, pas à chaque
            // frame de défilement.
            let scrolled = value < -2
            if scrolled != isContentScrolled {
                withAnimation(.easeOut(duration: 0.15)) { isContentScrolled = scrolled }
            }
        }
    }

}
