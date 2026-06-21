import SwiftUI
import VisionKit

/// Scans the QR code tauri-app's Sidebar displays for pairing — it encodes a
/// plain "host:port" string, the exact shape the manual address field
/// already accepts, so a successful scan needs no parsing beyond handing
/// the raw payload straight to `engineAddress`.
struct QRScannerView: UIViewControllerRepresentable {
    var onScan: (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let controller = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            qualityLevel: .balanced,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: false,
            isPinchToZoomEnabled: false,
            isGuidanceEnabled: true,
            isHighlightingEnabled: true
        )
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ uiViewController: DataScannerViewController, context: Context) {
        try? uiViewController.startScanning()
    }

    static func dismantleUIViewController(_ uiViewController: DataScannerViewController, coordinator: Coordinator) {
        uiViewController.stopScanning()
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onScan: onScan)
    }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        private let onScan: (String) -> Void
        private var hasScanned = false

        init(onScan: @escaping (String) -> Void) {
            self.onScan = onScan
        }

        func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            guard !hasScanned, let item = addedItems.first else { return }
            guard case .barcode(let barcode) = item, let value = barcode.payloadStringValue else { return }
            hasScanned = true
            dataScanner.stopScanning()
            onScan(value)
        }
    }
}

/// Full-screen scanner sheet with a fallback message on devices/simulators
/// that don't support VisionKit's live text/barcode scanning (DataScanner
/// needs a Neural Engine — unavailable on the Simulator and pre-A12
/// devices), so the manual address field always remains the way in.
struct QRScannerSheet: View {
    var onScan: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if DataScannerViewController.isSupported && DataScannerViewController.isAvailable {
                    QRScannerView { value in
                        onScan(value)
                        dismiss()
                    }
                    .ignoresSafeArea()
                } else {
                    ContentUnavailableView(
                        "Scanner indisponible",
                        systemImage: "qrcode.viewfinder",
                        description: Text("Ce simulateur ou cet appareil ne prend pas en charge le scan de QR Code. Saisissez l'adresse manuellement.")
                    )
                }
            }
            .navigationTitle("Scanner le QR Code")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
            }
        }
    }
}
