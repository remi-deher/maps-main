// The three resting states of the persistent bottom sheet.
enum SheetDetent: CaseIterable, Equatable {
    case collapsed  // just the search capsule
    case medium     // partial height - results / itinerary / place card
    case large      // full system sheet height
}
