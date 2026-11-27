import AppKit
import CryptoKit
import Foundation
import WebKit

private let gameURL = URL(string: "stormcore://game/stormcore.html")!
private let releasesURL = URL(string: "https://github.com/kopejkingeorgij09-web/3-/releases/latest")!
private let codeFormat = #"^[a-z0-9]{3,16}(?:-[a-hj-km-np-z2-9]{5}){4}$"#

private func isGameURL(_ url: URL?) -> Bool {
    guard let url else { return false }
    return url.scheme == gameURL.scheme && url.host == gameURL.host && url.path == gameURL.path
}

final class BundledGame: NSObject, WKURLSchemeHandler {
    private let data: Data

    init(data: Data) { self.data = data }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, isGameURL(url) else {
            task.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        let response = URLResponse(
            url: url, mimeType: "text/html", expectedContentLength: data.count, textEncodingName: "UTF-8"
        )
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

final class ProgressSessionDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

final class GameBridge: NSObject, WKScriptMessageHandlerWithReply {
    private let storeKey = "StormcoreStorage"
    private let defaults = UserDefaults.standard
    private let endpoint: URL
    private let session: URLSession

    init(endpoint: URL) {
        self.endpoint = endpoint
        let network = URLSessionConfiguration.ephemeral
        network.timeoutIntervalForRequest = 9
        network.timeoutIntervalForResource = 12
        self.session = URLSession(configuration: network, delegate: ProgressSessionDelegate(), delegateQueue: nil)
    }

    private var saved: [String: String] { defaults.object(forKey: storeKey) as? [String: String] ?? [:] }

    func script() throws -> WKUserScript {
        let encoded = try JSONSerialization.data(withJSONObject: saved).base64EncodedString()
        let javascript = """
        (() => {
          const content = Uint8Array.from(atob('\(encoded)'), byte => byte.charCodeAt(0));
          const state = new Map(Object.entries(JSON.parse(new TextDecoder().decode(content))));
          const send = message => window.webkit.messageHandlers.stormcore.postMessage(message);
          Object.defineProperty(window, 'stormcoreNative', {
            value: Object.freeze({
              storage: Object.freeze({
                getItem: key => state.get(String(key)) ?? null,
                setItem: (key,value) => {
                  state.set(String(key),String(value));
                  send({kind:'store',key:String(key),value:String(value)}).catch(()=>{});
                }
              }),
              digest: code => send({kind:'digest',code}),
              exchange: payload => send({kind:'exchange',payload}),
              copy: code => send({kind:'copy',code})
            })
          });
        })();
        """
        return WKUserScript(source: javascript, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    func userContentController(
        _ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard message.frameInfo.isMainFrame,
              isGameURL(message.frameInfo.request.url),
              let body = message.body as? [String: Any],
              let kind = body["kind"] as? String else {
            replyHandler(nil, "Invalid game message")
            return
        }

        switch kind {
        case "store":
            guard let key = body["key"] as? String, let value = body["value"] as? String,
                  value.utf8.count <= 1_048_576,
                  key.range(of: #"^stormcore-(best|campaign|pilot|muted|camera|reticle|seen-pilot|pending-[0-9a-f]{64})$"#,
                            options: .regularExpression) != nil else {
                replyHandler(nil, "Invalid storage value")
                return
            }
            var state = saved
            state[key] = value
            defaults.set(state, forKey: storeKey)
            replyHandler(true, nil)
        case "digest":
            guard let code = verifiedCode(body["code"]) else { replyHandler(nil, "Invalid code"); return }
            let digest = SHA256.hash(data: Data(code.utf8)).map { String(format: "%02x", $0) }.joined()
            replyHandler(digest, nil)
        case "copy":
            guard let code = verifiedCode(body["code"]) else { replyHandler(nil, "Invalid code"); return }
            NSPasteboard.general.clearContents()
            replyHandler(NSPasteboard.general.setString(code, forType: .string), nil)
        case "exchange":
            guard let payload = body["payload"] as? [String: Any],
                  let action = payload["action"] as? String,
                  ["create", "load", "save", "buy", "favorite", "tune", "reset", "restore"].contains(action),
                  let code = verifiedCode(payload["code"]) else {
                replyHandler(nil, "Invalid progress request")
                return
            }
            var outgoing: [String: Any] = [
                "action": action, "code": code,
                "cleared": (payload["cleared"] as? Int) ?? 0,
                "best": (payload["best"] as? Int) ?? 0
            ]
            if let campaign = payload["campaign"] as? Int, [2, 3, 4, 5].contains(campaign) {
                outgoing["campaign"] = campaign
                outgoing["credits"] = (payload["credits"] as? Int) ?? 0
                outgoing["owned"] = (payload["owned"] as? [Int]) ?? [0]
                outgoing["flights"] = (payload["flights"] as? [[String: Any]]) ?? []
                if let purchase = payload["purchase"] as? Int { outgoing["purchase"] = purchase }
                if campaign >= 3 {
                    for key in ["epoch", "ship", "favorite", "expectedTier", "duels", "duelPaid"] {
                        if let value = payload[key] as? Int { outgoing[key] = value }
                    }
                    for key in ["tuningKind", "transition"] {
                        if let value = payload[key] as? String { outgoing[key] = value }
                    }
                    if let tuning = payload["tuning"] as? [String: [String: Int]] { outgoing["tuning"] = tuning }
                }
            }
            exchange(outgoing, reply: replyHandler)
        default:
            replyHandler(nil, "Unknown game message")
        }
    }

    private func verifiedCode(_ value: Any?) -> String? {
        guard let code = value as? String, code.count <= 40,
              code.range(of: codeFormat, options: .regularExpression) != nil else { return nil }
        return code
    }

    private func exchange(_ payload: [String: Any], reply: @escaping (Any?, String?) -> Void) {
        var request = URLRequest(url: endpoint, cachePolicy: .reloadIgnoringLocalCacheData)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        } catch {
            reply(nil, "Invalid progress data")
            return
        }
        session.dataTask(with: request) { data, response, error in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let parsed = data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
            DispatchQueue.main.async {
                guard error == nil else { reply(nil, "Cloud unavailable"); return }
                let result: [String: Any] = ["status": status, "data": parsed ?? [:]]
                reply(result, nil)
            }
        }.resume()
    }
}

final class GameApplication: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    private var window: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        makeMenu()
        do {
            let bundle = Bundle.main
            guard let page = bundle.url(forResource: "stormcore", withExtension: "html"),
                  let urlString = bundle.object(forInfoDictionaryKey: "StormcoreProgressURL") as? String,
                  let endpoint = URL(string: urlString), endpoint.scheme == "https" else {
                throw URLError(.fileDoesNotExist)
            }

            let configuration = WKWebViewConfiguration()
            configuration.setURLSchemeHandler(BundledGame(data: try Data(contentsOf: page)), forURLScheme: "stormcore")
            let bridge = GameBridge(endpoint: endpoint)
            configuration.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "stormcore")
            configuration.userContentController.addUserScript(try bridge.script())
            let webView = WKWebView(frame: .zero, configuration: configuration)
            webView.navigationDelegate = self

            let rect = CGRect(x: 0, y: 0, width: 1160, height: 760)
            let window = NSWindow(
                contentRect: rect, styleMask: [.titled, .closable, .miniaturizable, .resizable],
                backing: .buffered, defer: false
            )
            let version = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
            window.title = version.isEmpty ? "Штормовое ядро" : "Штормовое ядро · \(version)"
            window.contentMinSize = NSSize(width: 500, height: 400)
            window.backgroundColor = NSColor(srgbRed: 0.05, green: 0.04, blue: 0.07, alpha: 1)
            window.collectionBehavior.insert(.fullScreenPrimary)
            window.contentView = webView
            window.setFrameAutosaveName("Stormcore")
            window.center()
            window.makeKeyAndOrderFront(nil)
            window.makeFirstResponder(webView)
            webView.load(URLRequest(url: gameURL))
            NSApp.activate(ignoringOtherApps: true)
            self.window = window
        } catch {
            let alert = NSAlert()
            alert.messageText = "Игра не загрузилась"
            alert.informativeText = "Проверь, что Stormcore.app целиком скопирован из DMG."
            alert.runModal()
            NSApp.terminate(nil)
        }
    }

    func webView(
        _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        decisionHandler(isGameURL(action.request.url) ? .allow : .cancel)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    @objc private func checkForUpdates() { NSWorkspace.shared.open(releasesURL) }

    private func makeMenu() {
        let main = NSMenu()
        let application = NSMenu()
        let app = NSMenuItem()
        app.submenu = application
        main.addItem(app)
        application.addItem(withTitle: "О программе «Штормовое ядро»",
                            action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        let updates = NSMenuItem(title: "Проверить обновления…", action: #selector(checkForUpdates), keyEquivalent: "")
        updates.target = self
        application.addItem(updates)
        application.addItem(.separator())
        application.addItem(withTitle: "Завершить «Штормовое ядро»",
                            action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        let edit = NSMenuItem(title: "Правка", action: nil, keyEquivalent: "")
        edit.submenu = NSMenu(title: "Правка")
        edit.submenu?.addItem(withTitle: "Копировать", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.submenu?.addItem(withTitle: "Вставить", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.submenu?.addItem(withTitle: "Выбрать всё", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        main.addItem(edit)

        let view = NSMenuItem(title: "Вид", action: nil, keyEquivalent: "")
        view.submenu = NSMenu(title: "Вид")
        let fullscreen = NSMenuItem(title: "Полноэкранный режим", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fullscreen.keyEquivalentModifierMask = [.command, .control]
        view.submenu?.addItem(fullscreen)
        main.addItem(view)
        NSApp.mainMenu = main
    }
}

@main
enum Stormcore {
    static func main() {
        let app = NSApplication.shared
        let delegate = GameApplication()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        withExtendedLifetime(delegate) { app.run() }
    }
}
