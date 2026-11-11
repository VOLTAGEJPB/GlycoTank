import AVFoundation
import Capacitor
import UIKit
import Vision
import VisionKit

// Barcode scanning and label reading on iPhone, using Apple's VisionKit and Vision.
// (Android uses Google ML Kit; ML Kit for iOS ships only through CocoaPods, which
// this Swift Package Manager project doesn't use.)
@objc(NativeScanPlugin)
public class NativeScanPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeScanPlugin"
    public let jsName = "NativeScan"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "scanBarcode", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readText", returnType: CAPPluginReturnPromise),
    ]

    private var scanner: BarcodeScannerController?

    // Opens a full-screen live camera scanner. Resolves { value } with the barcode
    // digits, or { value: null } if the user cancels.
    @objc func scanBarcode(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard DataScannerViewController.isSupported else {
                call.reject("This iPhone can't scan barcodes with the camera.", "UNAVAILABLE")
                return
            }
            switch AVCaptureDevice.authorizationStatus(for: .video) {
            case .authorized:
                self.presentScanner(call)
            case .notDetermined:
                AVCaptureDevice.requestAccess(for: .video) { granted in
                    DispatchQueue.main.async {
                        if granted { self.presentScanner(call) } else { self.rejectPermission(call) }
                    }
                }
            default:
                self.rejectPermission(call)
            }
        }
    }

    private func rejectPermission(_ call: CAPPluginCall) {
        call.reject("GlycoTank needs camera access to scan. Turn it on in Settings → GlycoTank → Camera.", "PERMISSION")
    }

    @MainActor
    private func presentScanner(_ call: CAPPluginCall) {
        guard DataScannerViewController.isAvailable, let presenter = bridge?.viewController else {
            call.reject("The camera isn't available right now.", "UNAVAILABLE")
            return
        }
        let controller = BarcodeScannerController { [weak self] code in
            self?.scanner = nil
            call.resolve(["value": code ?? NSNull()])
        }
        scanner = controller
        controller.present(from: presenter)
    }

    // Reads the text in a photo on the device. Resolves { text } with one line per
    // row of the image, top to bottom.
    @objc func readText(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), !path.isEmpty else {
            call.reject("No photo was given.")
            return
        }
        let fileURL: URL?
        if path.hasPrefix("file://") {
            fileURL = URL(string: path)
        } else if let range = path.range(of: "/_capacitor_file_") {
            fileURL = URL(fileURLWithPath: String(path[range.upperBound...]))
        } else {
            fileURL = URL(fileURLWithPath: path)
        }
        guard let url = fileURL, let image = UIImage(contentsOfFile: url.path), let cgImage = image.cgImage else {
            call.reject("Couldn't open the photo.")
            return
        }
        let orientation = CGImagePropertyOrientation(image.imageOrientation)
        DispatchQueue.global(qos: .userInitiated).async {
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = false
            do {
                try VNImageRequestHandler(cgImage: cgImage, orientation: orientation).perform([request])
            } catch {
                call.reject("Couldn't read the photo.", nil, error)
                return
            }
            call.resolve(["text": NativeScanPlugin.rows(request.results ?? [])])
        }
    }

    // Groups recognized text into rows, so "Total Fat 8g" and its "10%" column
    // stay on one line like on the printed label.
    static func rows(_ observations: [VNRecognizedTextObservation]) -> String {
        let items = observations.compactMap { obs -> (box: CGRect, text: String)? in
            guard let text = obs.topCandidates(1).first?.string else { return nil }
            return (obs.boundingBox, text)
        }.sorted { $0.box.midY > $1.box.midY } // Vision's y axis points up
        var rows: [[(box: CGRect, text: String)]] = []
        for item in items {
            if let last = rows.last?.last, abs(last.box.midY - item.box.midY) < max(last.box.height, item.box.height) * 0.5 {
                rows[rows.count - 1].append(item)
            } else {
                rows.append([item])
            }
        }
        return rows.map { $0.sorted { $0.box.minX < $1.box.minX }.map(\.text).joined(separator: " ") }
            .joined(separator: "\n")
    }
}

// The scanner screen: VisionKit's live camera view inside a navigation bar with Cancel.
final class BarcodeScannerController: NSObject, DataScannerViewControllerDelegate, UIAdaptivePresentationControllerDelegate {
    private let finish: (String?) -> Void
    private var done = false
    private var nav: UINavigationController?

    init(finish: @escaping (String?) -> Void) {
        self.finish = finish
    }

    func present(from presenter: UIViewController) {
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.ean13, .ean8, .upce])],
            qualityLevel: .balanced,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: false,
            isPinchToZoomEnabled: true,
            isGuidanceEnabled: true,
            isHighlightingEnabled: true
        )
        scanner.delegate = self
        scanner.title = "Scan barcode"
        scanner.navigationItem.leftBarButtonItem = UIBarButtonItem(
            systemItem: .cancel, primaryAction: UIAction { [weak self] _ in self?.close(nil) })
        let nav = UINavigationController(rootViewController: scanner)
        nav.modalPresentationStyle = .fullScreen
        nav.presentationController?.delegate = self
        self.nav = nav
        presenter.present(nav, animated: true) {
            do {
                try scanner.startScanning()
            } catch {
                self.close(nil)
            }
        }
    }

    func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
        for item in addedItems {
            if case .barcode(let barcode) = item, let value = barcode.payloadStringValue, !value.isEmpty {
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                close(value)
                return
            }
        }
    }

    func dataScanner(_ dataScanner: DataScannerViewController, becameUnavailableWithError error: DataScannerViewController.ScanningUnavailable) {
        close(nil)
    }

    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        close(nil)
    }

    private func close(_ value: String?) {
        guard !done else { return }
        done = true
        (nav?.viewControllers.first as? DataScannerViewController)?.stopScanning()
        nav?.dismiss(animated: true)
        finish(value)
    }
}

extension CGImagePropertyOrientation {
    init(_ orientation: UIImage.Orientation) {
        switch orientation {
        case .up: self = .up
        case .down: self = .down
        case .left: self = .left
        case .right: self = .right
        case .upMirrored: self = .upMirrored
        case .downMirrored: self = .downMirrored
        case .leftMirrored: self = .leftMirrored
        case .rightMirrored: self = .rightMirrored
        @unknown default: self = .up
        }
    }
}
