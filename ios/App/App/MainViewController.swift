import Capacitor
import UIKit

// The app's web view controller. Registers plugins that live in the app itself.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(NativeScanPlugin())
    }
}
