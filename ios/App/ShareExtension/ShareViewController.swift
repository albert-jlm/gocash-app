import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    private let appGroupId = "group.com.gocash.tracker.share"
    private let urlScheme = "gocashtracker://share"
    private let dataKey = "share-target-data"
    private var didProcessShare = false

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)

        guard !didProcessShare else { return }
        didProcessShare = true

        Task {
            do {
                let payload = try await buildPayload()
                savePayload(payload)
                openMainApp()
            } catch {
                extensionContext?.cancelRequest(withError: error)
            }
        }
    }

    private func buildPayload() async throws -> [String: Any] {
        guard let extensionItem = extensionContext?.inputItems.first as? NSExtensionItem,
              let attachments = extensionItem.attachments,
              !attachments.isEmpty else {
            throw NSError(domain: "ShareExtension", code: 1, userInfo: [NSLocalizedDescriptionKey: "No shared attachments found"])
        }

        var files: [[String: Any]] = []
        var texts: [String] = []

        for attachment in attachments {
            if attachment.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                if let file = try await copySharedFile(from: attachment) {
                    files.append(file)
                }
                continue
            }

            if attachment.hasItemConformingToTypeIdentifier(UTType.text.identifier),
               let text = try await loadSharedText(from: attachment) {
                texts.append(text)
            }
        }

        return [
            "title": extensionItem.attributedTitle?.string ?? "",
            "texts": texts,
            "files": files,
        ]
    }

    private func copySharedFile(from provider: NSItemProvider) async throws -> [String: Any]? {
        let incomingUrl = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<URL, Error>) in
            provider.loadFileRepresentation(forTypeIdentifier: UTType.image.identifier) { url, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                guard let url else {
                    continuation.resume(throwing: NSError(domain: "ShareExtension", code: 2, userInfo: [NSLocalizedDescriptionKey: "Shared file URL missing"]))
                    return
                }

                continuation.resume(returning: url)
            }
        }

        let fileManager = FileManager.default
        guard let containerUrl = fileManager.containerURL(forSecurityApplicationGroupIdentifier: appGroupId) else {
            throw NSError(domain: "ShareExtension", code: 3, userInfo: [NSLocalizedDescriptionKey: "Shared App Group container unavailable"])
        }

        let sharedDirectory = containerUrl.appendingPathComponent("SharedImages", isDirectory: true)
        try fileManager.createDirectory(at: sharedDirectory, withIntermediateDirectories: true, attributes: nil)

        let filename = UUID().uuidString + "." + incomingUrl.pathExtension
        let destinationUrl = sharedDirectory.appendingPathComponent(filename)

        if fileManager.fileExists(atPath: destinationUrl.path) {
            try fileManager.removeItem(at: destinationUrl)
        }

        try fileManager.copyItem(at: incomingUrl, to: destinationUrl)

        let mimeType = mimeType(for: destinationUrl.pathExtension)
        return [
            "uri": destinationUrl.absoluteString,
            "name": destinationUrl.lastPathComponent,
            "mimeType": mimeType,
        ]
    }

    private func loadSharedText(from provider: NSItemProvider) async throws -> String? {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<String?, Error>) in
            provider.loadItem(forTypeIdentifier: UTType.text.identifier, options: nil) { item, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                if let text = item as? String {
                    continuation.resume(returning: text)
                } else if let data = item as? Data, let text = String(data: data, encoding: .utf8) {
                    continuation.resume(returning: text)
                } else {
                    continuation.resume(returning: nil)
                }
            }
        }
    }

    private func savePayload(_ payload: [String: Any]) {
        let userDefaults = UserDefaults(suiteName: appGroupId)
        userDefaults?.set(payload, forKey: dataKey)
        userDefaults?.synchronize()
    }

    private func openMainApp() {
        guard let url = URL(string: urlScheme) else {
            extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
            return
        }

        var responder: UIResponder? = self
        let selector = NSSelectorFromString("openURL:")
        while let current = responder {
            if current.responds(to: selector) {
                _ = current.perform(selector, with: url)
                break
            }
            responder = current.next
        }

        extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }

    private func mimeType(for pathExtension: String) -> String {
        switch pathExtension.lowercased() {
        case "png":
            return "image/png"
        case "webp":
            return "image/webp"
        case "heic", "heif":
            return "image/heic"
        default:
            return "image/jpeg"
        }
    }
}
