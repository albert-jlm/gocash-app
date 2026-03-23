import Foundation
import Capacitor

@objc(CapacitorShareTargetPlugin)
public class CapacitorShareTargetPlugin: CAPPlugin, CAPBridgedPlugin {
    private let pluginVersion: String = "8.0.22-gocash"
    public let identifier = "CapacitorShareTargetPlugin"
    public let jsName = "CapacitorShareTarget"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getPluginVersion", returnType: CAPPluginReturnPromise)
    ]

    override public func load() {
        super.load()

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleOpenURL(_:)),
            name: .capacitorOpenURL,
            object: nil
        )

        checkForSharedContent()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc private func handleOpenURL(_ notification: Notification) {
        guard let object = notification.object as? [String: Any],
              let url = object["url"] as? URL else {
            return
        }

        if (url.scheme == "capacitor" && url.host == "share") || url.host == "share" || url.path == "/share" {
            checkForSharedContent()
        }
    }

    private func checkForSharedContent() {
        let appGroupId = getConfigValue("appGroupId") as? String ?? "group.YOUR_APP_GROUP_ID"

        guard appGroupId != "group.YOUR_APP_GROUP_ID" else {
            CAPLog.print("⚠️ ShareTarget: Configure 'appGroupId' in capacitor.config to receive share events.")
            return
        }

        guard let userDefaults = UserDefaults(suiteName: appGroupId) else {
            return
        }

        let possibleKeys = ["share-target-data", "SharedData"]
        var sharedData: [String: Any]?
        var usedKey: String?

        for key in possibleKeys {
          if let data = userDefaults.dictionary(forKey: key) {
                sharedData = data
                usedKey = key
                break
            }
        }

        guard let data = sharedData, let key = usedKey else {
            return
        }

        var shareEvent: [String: Any] = [:]
        shareEvent["title"] = data["title"] as? String ?? ""

        var texts: [String] = []
        if let sharedTexts = data["texts"] as? [String] {
            texts = sharedTexts
        } else if let sharedTexts = data["texts"] as? [[String: Any]] {
            texts = sharedTexts.compactMap { $0["value"] as? String }
        }
        shareEvent["texts"] = texts

        var files: [[String: Any]] = []
        if let sharedFiles = data["files"] as? [[String: Any]] {
            files = sharedFiles
        }
        shareEvent["files"] = files

        userDefaults.removeObject(forKey: key)
        userDefaults.synchronize()

        notifyListeners("shareReceived", data: shareEvent, retainUntilConsumed: true)
    }

    @objc func getPluginVersion(_ call: CAPPluginCall) {
        call.resolve(["version": self.pluginVersion])
    }
}
