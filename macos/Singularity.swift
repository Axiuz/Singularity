// App nativa de macOS: arranca LM Studio y el orquestador con launcher.sh
// y muestra el panel en una ventana propia (WKWebView), sin navegador.
import Cocoa
import LocalAuthentication
import WebKit

// El servidor solo sirve el panel a clientes con este user agent
let appUserAgent = "SingularityApp"

final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKScriptMessageHandler, NSMenuItemValidation {
  var window: NSWindow!
  var webView: WKWebView!
  let browser = BrowserHost()
  let launcher = Bundle.main.path(forResource: "launcher", ofType: "sh")!

  func applicationDidFinishLaunching(_ notification: Notification) {
    buildMenu()
    buildWindow()
    browser.restoreSessionCookies()
    showStatus("Arrancando LM Studio y el orquestador…")

    DispatchQueue.global(qos: .userInitiated).async {
      let (ok, output) = self.runLauncher("start")
      DispatchQueue.main.async {
        if ok, let url = URL(string: output.trimmingCharacters(in: .whitespacesAndNewlines)) {
          self.webView.load(URLRequest(url: url))
        } else {
          self.fatal(output)
        }
      }
    }
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

  // Se ejecuta al cerrar la app; intenta guardar las cookies antes de salir, y gira el runloop hasta 2 segundos para asegurar que getAllCookies termine asincrónicamente.
  func applicationWillTerminate(_ notification: Notification) {
    var saved = false
    browser.saveSessionCookies { saved = true }
    let deadline = Date().addingTimeInterval(2)
    while !saved && Date() < deadline { RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.05)) }
    _ = runLauncher("stop")
  }

  // Devuelve stdout si terminó bien, o stderr si falló
  func runLauncher(_ action: String) -> (Bool, String) {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/bash")
    process.arguments = [launcher, action]
    let out = Pipe()
    let err = Pipe()
    process.standardOutput = out
    process.standardError = err
    do {
      try process.run()
    } catch {
      return (false, error.localizedDescription)
    }
    let stdout = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    let stderr = String(data: err.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    process.waitUntilExit()
    return process.terminationStatus == 0 ? (true, stdout) : (false, stderr.isEmpty ? stdout : stderr)
  }

  func buildWindow() {
    let config = WKWebViewConfiguration()
    // WKWebView no siempre deja usar navigator.clipboard; lo resolvemos en nativo
    config.userContentController.add(self, name: "clipboard")
    // "Seleccione carpeta" del panel abre el diálogo nativo de Finder
    config.userContentController.add(self, name: "pickFolder")
    config.userContentController.add(self, name: "browser")
    config.userContentController.addUserScript(WKUserScript(
      source: """
        navigator.clipboard.writeText = (text) => {
          window.webkit.messageHandlers.clipboard.postMessage(String(text));
          return Promise.resolve();
        };
        """,
      injectionTime: .atDocumentStart,
      forMainFrameOnly: true))

    webView = WKWebView(frame: .zero, configuration: config)
    webView.customUserAgent = appUserAgent
    webView.uiDelegate = self
    // Desactiva el fondo del WebView para que no pinte opaco y se vea el material de fondo traslúcido definido por CSS
    webView.setValue(false, forKey: "drawsBackground")
    if #available(macOS 12.0, *) { webView.underPageBackgroundColor = .clear }

    let backdrop = NSVisualEffectView()
    backdrop.material = .underWindowBackground
    backdrop.blendingMode = .behindWindow
    // El estado activo mantiene el desenfoque incluso cuando la ventana no es la del frente, para mantener consistencia visual
    backdrop.state = .active
    webView.autoresizingMask = [.width, .height]
    backdrop.addSubview(webView)
    browser.panel = webView
    browser.container = backdrop

    window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered, defer: false)
    window.title = "Singularity"
    // Tres columnas (proyectos, centro, agentes) no caben en menos
    window.minSize = NSSize(width: 1000, height: 620)
    // Sin fullSizeContentView: la barra de título ya sale translúcida sola y así el panel no se mete debajo de los semáforos
    window.appearance = NSAppearance(named: .darkAqua)
    window.isOpaque = false
    window.backgroundColor = .clear
    window.contentView = backdrop
    webView.frame = backdrop.bounds
    window.center()
    window.setFrameAutosaveName("SingularityMain")
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  func showStatus(_ text: String) {
    webView.loadHTMLString("""
      <body style="margin:0;height:100vh;display:grid;place-items:center;background:transparent;
      color:#a2a29a;font:14px -apple-system,system-ui">\(text)</body>
      """, baseURL: nil)
  }

  func fatal(_ message: String) {
    let alert = NSAlert()
    alert.messageText = "No se pudo arrancar Singularity"
    alert.informativeText = message
    alert.alertStyle = .critical
    alert.runModal()
    NSApp.terminate(nil)
  }

  func buildMenu() {
    let main = NSMenu()

    let appItem = NSMenuItem()
    let appMenu = NSMenu()
    appMenu.addItem(withTitle: "Ocultar Singularity", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "Salir de Singularity", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    appItem.submenu = appMenu
    main.addItem(appItem)

    // Sin menú Edición, Cmd+C / Cmd+V no llegan a los campos de texto del panel
    let editItem = NSMenuItem()
    let editMenu = NSMenu(title: "Edición")
    editMenu.addItem(withTitle: "Deshacer", action: Selector(("undo:")), keyEquivalent: "z")
    editMenu.addItem(withTitle: "Rehacer", action: Selector(("redo:")), keyEquivalent: "Z")
    editMenu.addItem(.separator())
    editMenu.addItem(withTitle: "Cortar", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    editMenu.addItem(withTitle: "Copiar", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    editMenu.addItem(withTitle: "Pegar", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    editMenu.addItem(withTitle: "Seleccionar todo", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    editItem.submenu = editMenu
    main.addItem(editItem)

    let viewItem = NSMenuItem()
    let viewMenu = NSMenu(title: "Ver")
    viewMenu.addItem(withTitle: "Recargar", action: #selector(reload), keyEquivalent: "r")
    viewItem.submenu = viewMenu
    main.addItem(viewItem)

    let browserItem = NSMenuItem()
    let browserMenu = NSMenu(title: "Navegador")
    browserMenu.addItem(withTitle: "Nueva pestaña", action: #selector(browserNewTab), keyEquivalent: "t")
    browserMenu.addItem(withTitle: "Cerrar pestaña", action: #selector(browserCloseTab), keyEquivalent: "w")
    browserMenu.addItem(withTitle: "Ir a la barra de dirección", action: #selector(browserFocusUrl), keyEquivalent: "l")
    browserMenu.addItem(.separator())
    browserMenu.addItem(withTitle: "Atrás", action: #selector(browserBack), keyEquivalent: "[")
    browserMenu.addItem(withTitle: "Adelante", action: #selector(browserForward), keyEquivalent: "]")
    browserItem.submenu = browserMenu
    main.addItem(browserItem)

    let windowItem = NSMenuItem()
    let windowMenu = NSMenu(title: "Ventana")
    windowMenu.addItem(withTitle: "Minimizar", action: #selector(NSWindow.miniaturize(_:)), keyEquivalent: "m")
    windowItem.submenu = windowMenu
    main.addItem(windowItem)

    NSApp.mainMenu = main
  }

  @objc func reload() {
    if browser.hasFocus(in: window) { browser.active.flatMap { browser.tabs[$0] }?.reload() } else { webView.reload() }
  }

  @objc func browserNewTab() { browser.command("new") }
  @objc func browserCloseTab() { browser.command("close") }
  @objc func browserFocusUrl() { browser.command("focusUrl") }
  @objc func browserBack() { browser.active.flatMap { browser.tabs[$0] }?.goBack() }
  @objc func browserForward() { browser.active.flatMap { browser.tabs[$0] }?.goForward() }

  func validateMenuItem(_ item: NSMenuItem) -> Bool {
    switch item.action {
    case #selector(browserNewTab): return browser.visible
    case #selector(browserCloseTab), #selector(browserFocusUrl), #selector(browserBack), #selector(browserForward):
      return browser.visible && browser.hasFocus(in: window)
    default: return true
    }
  }

  // ---- Puentes con el panel: portapapeles y selector de carpeta ----
  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    switch message.name {
    case "clipboard":
      guard let text = message.body as? String else { return }
      NSPasteboard.general.clearContents()
      NSPasteboard.general.setString(text, forType: .string)
    case "pickFolder":
      pickFolder()
    case "browser":
      guard message.frameInfo.isMainFrame, message.webView === webView,
            let body = message.body as? [String: Any] else { return }
      browser.handle(body)
    default:
      break
    }
  }

  func pickFolder() {
    let panel = NSOpenPanel()
    panel.canChooseDirectories = true
    panel.canChooseFiles = false
    panel.allowsMultipleSelection = false
    panel.prompt = "Abrir proyecto"
    panel.message = "Elige la carpeta del proyecto donde se abrirá Claude Code"
    panel.beginSheetModal(for: window) { response in
      guard response == .OK, let path = panel.url?.path,
            let json = try? JSONEncoder().encode(path),
            let arg = String(data: json, encoding: .utf8) else { return }
      // JSON escapa comillas y barras: la ruta llega intacta como string de JS
      self.webView.evaluateJavaScript("window.onFolderPicked(\(arg))")
    }
  }

  // ---- alert / confirm / prompt del panel ----
  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
               initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
    let alert = NSAlert()
    alert.messageText = message
    alert.runModal()
    completionHandler()
  }

  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
               initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    let alert = NSAlert()
    alert.messageText = message
    alert.addButton(withTitle: "Aceptar")
    alert.addButton(withTitle: "Cancelar")
    completionHandler(alert.runModal() == .alertFirstButtonReturn)
  }

  func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
               defaultText: String?, initiatedByFrame frame: WKFrameInfo,
               completionHandler: @escaping (String?) -> Void) {
    let alert = NSAlert()
    alert.messageText = prompt
    alert.addButton(withTitle: "Aceptar")
    alert.addButton(withTitle: "Cancelar")
    let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
    field.stringValue = defaultText ?? ""
    alert.accessoryView = field
    alert.window.initialFirstResponder = field
    completionHandler(alert.runModal() == .alertFirstButtonReturn ? field.stringValue : nil)
  }
}

// Contraseñas del navegador en el llavero de macOS, una entrada genérica por origen y cuenta.
// Genéricas y con prefijo propio: las de internet de github.com, por ejemplo, ya las usa git.
enum Passwords {
  static let prefix = "Singularity web: "

  static func base(_ origin: String) -> [String: Any] {
    [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: prefix + origin]
  }

  static func accounts(_ origin: String) -> [String] {
    var query = base(origin)
    query[kSecMatchLimit as String] = kSecMatchLimitAll
    query[kSecReturnAttributes as String] = true
    var result: AnyObject?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
          let items = result as? [[String: Any]] else { return [] }
    return items.compactMap { $0[kSecAttrAccount as String] as? String }.sorted()
  }

  static func password(_ origin: String, _ account: String) -> String? {
    var query = base(origin)
    query[kSecAttrAccount as String] = account
    query[kSecReturnData as String] = true
    var result: AnyObject?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }

  static func save(_ origin: String, _ account: String, _ password: String) {
    var query = base(origin)
    query[kSecAttrAccount as String] = account
    let data = Data(password.utf8)
    if SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary) == errSecItemNotFound {
      query[kSecValueData as String] = data
      query[kSecAttrLabel as String] = prefix + origin
      SecItemAdd(query as CFDictionary, nil)
    }
  }

  static func delete(_ origin: String, _ account: String) {
    var query = base(origin)
    query[kSecAttrAccount as String] = account
    SecItemDelete(query as CFDictionary)
  }

  static func all() -> [[String: String]] {
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                kSecMatchLimit as String: kSecMatchLimitAll, kSecReturnAttributes as String: true]
    var result: AnyObject?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
          let items = result as? [[String: Any]] else { return [] }
    return items.compactMap { item in
      guard let service = item[kSecAttrService as String] as? String, service.hasPrefix(prefix),
            let account = item[kSecAttrAccount as String] as? String else { return nil }
      return ["origin": String(service.dropFirst(prefix.count)), "account": account]
    }
  }

  // Corre en un mundo aislado: el JS de la página no ve window.webkit.messageHandlers de aquí,
  // así que una web no puede pedir contraseñas; solo este script, y solo para su propio origen.
  static let script = """
    (() => {
      const post = (m) => window.webkit.messageHandlers.passwords.postMessage(m);
      const visible = (el) => el.offsetParent !== null || el.getClientRects().length > 0;
      const passwords = () => [...document.querySelectorAll('input[type="password"]')].filter(visible);
      const userFor = (pass) => [...(pass.form || document).querySelectorAll("input")]
        .filter((i) => /^(text|email|tel)$/.test(i.type) && visible(i) &&
          (i.compareDocumentPosition(pass) & Node.DOCUMENT_POSITION_FOLLOWING))
        .pop() || null;
      let fields = null;
      document.addEventListener("mousedown", (e) => {
        const el = e.target;
        if (!(el instanceof HTMLInputElement)) return;
        const pass = el.type === "password" ? el : passwords().find((p) => userFor(p) === el);
        if (!pass) return;
        fields = { pass, user: userFor(pass) };
        const r = el.getBoundingClientRect();
        post({ op: "fillMenu", x: r.left, y: r.bottom });
      }, true);
      const setValue = (el, value) => {
        if (!el) return;
        el.focus();
        el.value = value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      };
      window.__singularityFill = (user, pass) => {
        if (!fields) return;
        setValue(fields.user, user);
        setValue(fields.pass, pass);
      };
      const capture = () => {
        const pass = passwords().find((p) => p.value);
        if (pass) post({ op: "capture", user: userFor(pass)?.value || "", pass: pass.value });
      };
      document.addEventListener("submit", capture, true);
      document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target instanceof HTMLInputElement) capture(); }, true);
      document.addEventListener("click", (e) => {
        if (e.target instanceof Element && e.target.closest('button, input[type="submit"], input[type="button"], [role="button"], a')) capture();
      }, true);
    })();
    """
}

// Navegador integrado: un WKWebView por pestaña, colocado encima del panel en el hueco
// que este le indica (#browserView). La lista de pestañas la lleva el panel; aquí viven las vistas.
final class BrowserHost: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, WKScriptMessageHandler {
  weak var panel: WKWebView?
  weak var container: NSView?
  var tabs: [String: WKWebView] = [:]
  var observers: [String: [NSKeyValueObservation]] = [:]
  var active: String?
  var visible = false
  var rect = CGRect.zero
  var downloadIds: [WKDownload: String] = [:]
  var downloadPaths: [WKDownload: URL] = [:]
  var downloadObservers: [WKDownload: NSKeyValueObservation] = [:]
  let downloadsDir = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
  var trackerList: WKContentRuleList?
  var blocking = false

  // Desactiva ITP y bloqueo de cookies de terceros de WebKit para permitir inicios de sesión entre dominios, como en Canvas con SSO. Se usan métodos privados porque no hay API pública.
  // method(for:) en vez de perform(_:with:), que pasaría un objeto y no un Bool. La lista de EasyPrivacy sigue bloqueando rastreadores.
  lazy var dataStore: WKWebsiteDataStore = {
    let store = WKWebsiteDataStore.default()
    let stats = NSSelectorFromString("_setResourceLoadStatisticsEnabled:")
    if store.responds(to: stats) {
      typealias SetBool = @convention(c) (AnyObject, Selector, Bool) -> Void
      unsafeBitCast(store.method(for: stats), to: SetBool.self)(store, stats, false)
    }
    let thirdParty = NSSelectorFromString("_setThirdPartyCookieBlockingMode:onlyOnSitesWithoutUserInteraction:completionHandler:")
    if store.responds(to: thirdParty) {
      typealias SetMode = @convention(c) (AnyObject, Selector, Bool, Bool, @convention(block) () -> Void) -> Void
      unsafeBitCast(store.method(for: thirdParty), to: SetMode.self)(store, thirdParty, false, false, {})
    }
    return store
  }()

  // Recibe operaciones del panel (frame, open, select, close, go, back, forward, reload, stop).
  // Después de cada operación, llama a layout() para recolocar las vistas.
  // Un "open" con un id que ya existe solo reemite su estado: pasa al recargar el panel (⌘R),
  // que vuelve a pedir las pestañas guardadas mientras las vistas nativas siguen vivas.
  func handle(_ body: [String: Any]) {
    guard let op = body["op"] as? String else { return }
    if op == "open" && !cookiesReady {
      pendingOpens.append(body)
      return
    }
    let id = body["id"] as? String
    switch op {
    case "frame":
      visible = body["visible"] as? Bool ?? false
      if let r = body["rect"] as? [String: Any] {
        rect = CGRect(x: num(r["x"]), y: num(r["y"]), width: num(r["width"]), height: num(r["height"]))
      }
    case "open":
      guard let id else { return }
      if tabs[id] == nil {
        let view = add(id, configuration: nil)
        if let url = (body["url"] as? String).flatMap(URL.init(string:)) { view.load(URLRequest(url: url)) }
      } else {
        emit(id)
      }
      if body["select"] as? Bool == true { active = id }
    case "select":
      active = id
    case "close":
      guard let id else { return }
      remove(id)
    case "go":
      guard let id, let url = (body["url"] as? String).flatMap(URL.init(string:)) else { return }
      tabs[id]?.load(URLRequest(url: url))
    case "back": id.flatMap { tabs[$0] }?.goBack()
    case "forward": id.flatMap { tabs[$0] }?.goForward()
    case "reload": id.flatMap { tabs[$0] }?.reload()
    case "stop": id.flatMap { tabs[$0] }?.stopLoading()
    // Con auto, antes se mira si suena audio o vídeo para no matar esa pestaña. La respuesta llega
    // asíncrona: se vuelve a comprobar que la vista sigue siendo la misma y que no es la activa.
    case "unload":
      guard let id, let view = tabs[id] else { return }
      if body["auto"] as? Bool == true {
        view.requestMediaPlaybackState { [weak self] state in
          guard state != .playing, let self, self.tabs[id] === view, self.active != id else { return }
          self.unload(id)
        }
        return
      }
      unload(id)
    // Dice al panel qué vistas siguen vivas, para que al recargarse no reabra las pestañas.
    case "alive":
      send(["alive": Array(tabs.keys)])
    case "blocklist":
      setBlocklist(enabled: body["enabled"] as? Bool ?? false, version: body["version"] as? String,
                   rules: body["rules"] as? String)
      return
    case "openDownloads": NSWorkspace.shared.open(downloadsDir)
    case "openDownload", "revealDownload":
      guard let url = insideDownloads(body["path"]) else { return }
      if op == "openDownload" { NSWorkspace.shared.open(url) } else { NSWorkspace.shared.activateFileViewerSelecting([url]) }
    case "passwords":
      send(["passwords": Passwords.all(), "never": neverSave, "offer": offerSave])
      return
    case "passwordsOffer":
      offerSave = body["enabled"] as? Bool ?? true
      UserDefaults.standard.set(offerSave, forKey: "passwordsOffer")
      return
    case "passwordCopy", "passwordDelete", "passwordEdit":
      guard let origin = body["origin"] as? String, let account = body["account"] as? String else { return }
      if op == "passwordCopy" { return copyPassword(origin: origin, account: account) }
      if op == "passwordEdit" { return editPassword(origin: origin, account: account) }
      Passwords.delete(origin, account)
      send(["passwordsChanged": true])
      return
    case "passwordNeverRemove":
      neverSave.removeAll { $0 == body["origin"] as? String }
      send(["passwordsChanged": true])
      return
    case "siteData":
      dataStore.fetchDataRecords(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes()) { [weak self] records in
        guard let self else { return }
        let sites = records.filter { !self.isPanelSite($0.displayName) }
          .map { ["name": $0.displayName, "kinds": self.kinds(of: $0.dataTypes)] as [String: Any] }
        self.send(["siteData": sites])
      }
      return
    case "clearData":
      clearData(kinds: body["kinds"] as? [String] ?? [], since: num(body["since"]))
      return
    case "clearSite":
      guard let name = body["name"] as? String, !isPanelSite(name) else { return }
      dataStore.fetchDataRecords(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes()) { [weak self] records in
        guard let self else { return }
        self.dataStore.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(),
                                  for: records.filter { $0.displayName == name }) {
          self.saveSessionCookies()
          self.send(["siteCleared": name])
        }
      }
      return
    default: return
    }
    layout()
  }

  // El panel vive en el mismo almacén que las pestañas: borrar su origen se llevaría
  // su localStorage (pestañas, borradores, anchos). Por eso nunca se lista ni se borra.
  func isPanelSite(_ name: String) -> Bool {
    ["localhost", "127.0.0.1", panel?.url?.host ?? ""].contains(name.lowercased())
  }

  let cookieTypes: Set<String> = [WKWebsiteDataTypeCookies]
  let cacheTypes: Set<String> = [WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeMemoryCache,
                                 WKWebsiteDataTypeOfflineWebApplicationCache, WKWebsiteDataTypeFetchCache]

  func types(for kinds: [String]) -> Set<String> {
    var types = Set<String>()
    if kinds.contains("cookies") { types.formUnion(cookieTypes) }
    if kinds.contains("cache") { types.formUnion(cacheTypes) }
    if kinds.contains("storage") {
      types.formUnion(WKWebsiteDataStore.allWebsiteDataTypes().subtracting(cookieTypes).subtracting(cacheTypes))
    }
    return types
  }

  func kinds(of types: Set<String>) -> [String] {
    var kinds: [String] = []
    if !types.isDisjoint(with: cookieTypes) { kinds.append("cookies") }
    if !types.isDisjoint(with: cacheTypes) { kinds.append("cache") }
    if !types.subtracting(cookieTypes).subtracting(cacheTypes).isEmpty { kinds.append("storage") }
    return kinds
  }

  // since en ms. Con rango solo se tocan cookies y caché: el almacenamiento del panel cambia a cada
  // momento y caería dentro de cualquier rango. Sin rango se borra por sitio, saltando el panel.
  func clearData(kinds: [String], since: CGFloat) {
    let done = { [weak self] in
      self?.saveSessionCookies()
      self?.send(["dataCleared": true])
    }
    if since > 0 {
      let types = self.types(for: kinds).intersection(cookieTypes.union(cacheTypes))
      guard !types.isEmpty else { return done() }
      dataStore.removeData(ofTypes: types, modifiedSince: Date(timeIntervalSince1970: Double(since) / 1000), completionHandler: done)
      return
    }
    let types = self.types(for: kinds)
    guard !types.isEmpty else { return done() }
    dataStore.fetchDataRecords(ofTypes: types) { [weak self] records in
      guard let self else { return }
      self.dataStore.removeData(ofTypes: types, for: records.filter { !self.isPanelSite($0.displayName) }, completionHandler: done)
    }
  }

  func num(_ value: Any?) -> CGFloat { CGFloat((value as? NSNumber)?.doubleValue ?? 0) }

  // Almacén persistente: las sesiones iniciadas sobreviven al cerrar la app.
  // Sin "Version/… Safari" en el user agent, Google y otros sitios sirven una versión degradada.
  func makeConfiguration() -> WKWebViewConfiguration {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = dataStore
    config.applicationNameForUserAgent = "Version/18.0 Safari/605.1.15"
    config.upgradeKnownHostsToHTTPS = true
    config.preferences.isFraudulentWebsiteWarningEnabled = true
    // Habilita la pantalla completa para elementos en WKWebView, necesario para que YouTube permita entrar en modo pantalla completa.
    config.preferences.isElementFullscreenEnabled = true
    // Habilita la inspección de elementos en WebKit para permitir el acceso al Web Inspector.
    // Preferencia privada por KVC: isInspectable solo deja inspeccionar desde el menú Desarrollo de Safari.
    config.preferences.setValue(true, forKey: "developerExtrasEnabled")
    if #available(macOS 15.2, *) { config.defaultWebpagePreferences.preferredHTTPSNavigationPolicy = .automaticFallbackToHTTP }
    // Las ventanas que abre una web (createWebViewWith) heredan esta configuración con el handler ya puesto.
    config.userContentController.addUserScript(WKUserScript(source: Passwords.script, injectionTime: .atDocumentEnd,
                                                            forMainFrameOnly: true, in: passwordWorld))
    config.userContentController.add(self, contentWorld: passwordWorld, name: "passwords")
    return config
  }

  // ---- Contraseñas ----
  let passwordWorld = WKContentWorld.world(name: "SingularityPasswords")
  var offerSave = UserDefaults.standard.object(forKey: "passwordsOffer") as? Bool ?? true
  var pendingSave: DispatchWorkItem?

  // https, o http solo en esta máquina: una contraseña tecleada en http viaja en claro y no se guarda.
  func originOf(_ frame: WKFrameInfo) -> String? {
    let o = frame.securityOrigin
    let local = ["localhost", "127.0.0.1"].contains(o.host)
    guard !o.host.isEmpty, o.protocol == "https" || (o.protocol == "http" && local) else { return nil }
    let defaultPort = (o.protocol == "https" && o.port == 443) || (o.protocol == "http" && o.port == 80)
    return "\(o.protocol)://\(o.host)" + (o.port == 0 || defaultPort ? "" : ":\(o.port)")
  }

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.world == passwordWorld, message.frameInfo.isMainFrame, let view = message.webView,
          let body = message.body as? [String: Any], let origin = originOf(message.frameInfo) else { return }
    switch body["op"] as? String {
    case "fillMenu":
      showFillMenu(view, origin: origin, at: CGPoint(x: num(body["x"]), y: num(body["y"])))
    case "capture":
      guard offerSave, let pass = body["pass"] as? String, !pass.isEmpty else { return }
      let user = body["user"] as? String ?? ""
      // Un login dispara submit, Enter y clic a la vez: se pregunta una sola vez, con lo último.
      pendingSave?.cancel()
      let work = DispatchWorkItem { [weak self] in self?.askToSave(origin: origin, user: user, pass: pass, in: view) }
      pendingSave = work
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.2, execute: work)
    default: break
    }
  }

  var neverSave: [String] {
    get { UserDefaults.standard.stringArray(forKey: "passwordsNever") ?? [] }
    set { UserDefaults.standard.set(newValue, forKey: "passwordsNever") }
  }

  func askToSave(origin: String, user: String, pass: String, in view: WKWebView) {
    guard !neverSave.contains(origin), Passwords.password(origin, user) != pass, let window = view.window else { return }
    let exists = Passwords.accounts(origin).contains(user)
    let alert = NSAlert()
    alert.messageText = exists ? "¿Actualizar la contraseña guardada?" : "¿Guardar la contraseña en el llavero?"
    alert.informativeText = "\(user.isEmpty ? "Sin usuario" : user) en \(origin)"
    alert.addButton(withTitle: exists ? "Actualizar" : "Guardar")
    alert.addButton(withTitle: "Ahora no")
    alert.addButton(withTitle: "Nunca para este sitio")
    alert.beginSheetModal(for: window) { [weak self] response in
      if response == .alertFirstButtonReturn { Passwords.save(origin, user, pass) }
      if response == .alertThirdButtonReturn { self?.neverSave.append(origin) }
      self?.send(["passwordsChanged": true])
    }
  }

  // Menú nativo en el campo: rellenar exige que el usuario elija la cuenta.
  func showFillMenu(_ view: WKWebView, origin: String, at point: CGPoint) {
    let accounts = Passwords.accounts(origin)
    guard !accounts.isEmpty else { return }
    let menu = NSMenu()
    for account in accounts {
      let item = NSMenuItem(title: account.isEmpty ? "(sin usuario)" : account, action: #selector(fillPicked(_:)), keyEquivalent: "")
      item.target = self
      item.representedObject = ["origin": origin, "account": account, "view": view] as [String: Any]
      menu.addItem(item)
    }
    let y = view.isFlipped ? point.y : view.bounds.height - point.y
    menu.popUp(positioning: nil, at: CGPoint(x: point.x, y: y + (view.isFlipped ? 4 : -4)), in: view)
  }

  @objc func fillPicked(_ item: NSMenuItem) {
    guard let info = item.representedObject as? [String: Any], let origin = info["origin"] as? String,
          let account = info["account"] as? String, let view = info["view"] as? WKWebView,
          let pass = Passwords.password(origin, account),
          // El origen puede haber cambiado mientras el menú estaba abierto.
          view.url.flatMap({ URL(string: origin)?.host == $0.host }) == true else { return }
    view.callAsyncJavaScript("window.__singularityFill(user, pass)", arguments: ["user": account, "pass": pass],
                             in: nil, in: passwordWorld)
  }

  // Editar también pide Touch ID, y el formulario es nativo: la contraseña nueva no pasa por el panel.
  // Vacía, se queda la que había. Cambiar el usuario a uno que ya existe en ese origen se rechaza.
  func editPassword(origin: String, account: String) {
    LAContext().evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "editar la contraseña de \(origin)") { ok, _ in
      DispatchQueue.main.async {
        guard ok, let current = Passwords.password(origin, account), let window = self.panel?.window else { return }
        let user = NSTextField(frame: NSRect(x: 0, y: 32, width: 300, height: 24))
        user.stringValue = account
        user.placeholderString = "Usuario"
        let pass = NSSecureTextField(frame: NSRect(x: 0, y: 0, width: 300, height: 24))
        pass.placeholderString = "Contraseña nueva (vacía: no cambia)"
        let fields = NSView(frame: NSRect(x: 0, y: 0, width: 300, height: 56))
        fields.addSubview(user)
        fields.addSubview(pass)
        let alert = NSAlert()
        alert.messageText = "Editar contraseña"
        alert.informativeText = origin
        alert.accessoryView = fields
        alert.addButton(withTitle: "Guardar")
        alert.addButton(withTitle: "Cancelar")
        alert.window.initialFirstResponder = pass
        alert.beginSheetModal(for: window) { response in
          guard response == .alertFirstButtonReturn else { return }
          let newUser = user.stringValue.trimmingCharacters(in: .whitespaces)
          let newPass = pass.stringValue.isEmpty ? current : pass.stringValue
          if newUser != account, Passwords.accounts(origin).contains(newUser) {
            let clash = NSAlert()
            clash.messageText = "Ya hay una contraseña guardada para \(newUser.isEmpty ? "(sin usuario)" : newUser) en este sitio."
            return clash.beginSheetModal(for: window)
          }
          Passwords.save(origin, newUser, newPass)
          if newUser != account { Passwords.delete(origin, account) }
          self.send(["passwordsChanged": true])
        }
      }
    }
  }

  // Ver o copiar una contraseña pide Touch ID o la contraseña del Mac. Se copia, no se manda al panel,
  // y el portapapeles se vacía al minuto si nadie copió otra cosa.
  func copyPassword(origin: String, account: String) {
    let context = LAContext()
    context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "copiar la contraseña de \(origin)") { ok, _ in
      DispatchQueue.main.async {
        guard ok, let pass = Passwords.password(origin, account) else { return }
        let board = NSPasteboard.general
        board.clearContents()
        board.setString(pass, forType: .string)
        let count = board.changeCount
        self.send(["passwordCopied": true])
        DispatchQueue.main.asyncAfter(deadline: .now() + 60) { if board.changeCount == count { board.clearContents() } }
      }
    }
  }

  // WebKit tira las cookies de sesión (sin fecha de caducidad) al cerrar la app aunque el almacén sea
  // persistente, y muchos portales (Canvas, Tecmilenio) guardan ahí el login: se guardan a mano y se
  // restauran al abrir. Van a un archivo 0600, como la llave de WebCrypto, porque son credenciales.
  lazy var sessionCookiesFile: URL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    .appendingPathComponent("Singularity", isDirectory: true)
    .appendingPathComponent("session-cookies.plist")
  var cookiesReady = false
  var pendingOpens: [[String: Any]] = []
  var cookieTimer: Timer?

  // Restaura las cookies de sesión desde el archivo plist al inicio de la app. Los open del panel esperan
  // a que termine, o la pestaña cargaría sin sesión; el tope de 3 s es por si setCookie no responde.
  func restoreSessionCookies() {
    let saved = (try? Data(contentsOf: sessionCookiesFile))
      .flatMap { try? PropertyListSerialization.propertyList(from: $0, format: nil) as? [[String: Any]] } ?? []
    let store = dataStore.httpCookieStore
    let group = DispatchGroup()
    for props in saved {
      let keyed = Dictionary(props.map { (HTTPCookiePropertyKey($0.key), $0.value) }, uniquingKeysWith: { a, _ in a })
      guard let cookie = HTTPCookie(properties: keyed) else { continue }
      group.enter()
      store.setCookie(cookie) { group.leave() }
    }
    group.notify(queue: .main) { [weak self] in self?.cookiesRestored() }
    DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.cookiesRestored() }
  }

  // Se ejecuta tras restaurar todas las cookies; procesa las pestañas pendientes e inicia el guardado
  // cada 60 s, por si la app muere sin pasar por applicationWillTerminate.
  func cookiesRestored() {
    guard !cookiesReady else { return }
    cookiesReady = true
    let opens = pendingOpens
    pendingOpens = []
    opens.forEach { handle($0) }
    cookieTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in self?.saveSessionCookies() }
  }

  // Guarda las cookies de sesión en formato plist, solo los valores compatibles con plist (URL como string, Date, String, NSNumber), y con permisos 0600 para seguridad.
  func saveSessionCookies(then done: (() -> Void)? = nil) {
    dataStore.httpCookieStore.getAllCookies { [weak self] cookies in
      guard let self else { done?(); return }
      let list: [[String: Any]] = cookies.filter(\.isSessionOnly).compactMap { cookie in
        guard let props = cookie.properties else { return nil }
        var out: [String: Any] = [:]
        for (key, value) in props {
          if let url = value as? URL { out[key.rawValue] = url.absoluteString }
          else if value is String || value is Date || value is NSNumber { out[key.rawValue] = value }
        }
        return out
      }
      if let data = try? PropertyListSerialization.data(fromPropertyList: list, format: .binary, options: 0) {
        try? FileManager.default.createDirectory(at: self.sessionCookiesFile.deletingLastPathComponent(), withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: self.sessionCookiesFile.path, contents: data, attributes: [.posixPermissions: 0o600])
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: self.sessionCookiesFile.path)
      }
      done?()
    }
  }

  // Sin esto WebKit guarda la llave maestra de WebCrypto en el llavero, y con un certificado autofirmado
  // macOS vuelve a pedir la contraseña sin parar (WhatsApp Web la usa en cada carga). Va a un archivo 0600.
  lazy var webCryptoKey: Data = {
    let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("Singularity", isDirectory: true)
    let file = dir.appendingPathComponent("webcrypto-master.key")
    if let saved = try? Data(contentsOf: file), saved.count == 16 { return saved }
    let key = Data((0..<16).map { _ in UInt8.random(in: .min ... .max) })
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    FileManager.default.createFile(atPath: file.path, contents: key, attributes: [.posixPermissions: 0o600])
    return key
  }()

  // Métodos privados de WKNavigationDelegate: el primero lo usan las versiones nuevas de WebKit, el segundo las viejas.
  @objc(_webCryptoMasterKeyForWebView:completionHandler:)
  func webCryptoMasterKey(_ webView: WKWebView, completionHandler: @escaping (Data?) -> Void) {
    completionHandler(webCryptoKey)
  }

  @objc(_webCryptoMasterKeyForWebView:)
  func webCryptoMasterKey(_ webView: WKWebView) -> Data? { webCryptoKey }

  // Las vistas del navegador no llevan ningún message handler: una web cualquiera no puede
  // tocar el portapapeles ni el panel. El KVO de title, url, isLoading, canGoBack y canGoForward
  // avisa al panel de cada cambio.
  @discardableResult
  func add(_ id: String, configuration: WKWebViewConfiguration?) -> WKWebView {
    let view = WKWebView(frame: .zero, configuration: configuration ?? makeConfiguration())
    view.navigationDelegate = self
    view.uiDelegate = self
    view.allowsBackForwardNavigationGestures = true
    view.isHidden = true
    view.wantsLayer = true
    view.layer?.cornerRadius = 8
    view.layer?.masksToBounds = true
    if #available(macOS 13.3, *) { view.isInspectable = true }
    applyBlocklist(to: view)
    if let container, let panel { container.addSubview(view, positioned: .above, relativeTo: panel) }
    tabs[id] = view
    let changed: (Any, Any) -> Void = { [weak self] _, _ in self?.emit(id) }
    observers[id] = [
      view.observe(\.title, changeHandler: changed),
      view.observe(\.url, changeHandler: changed),
      view.observe(\.isLoading, changeHandler: changed),
      view.observe(\.canGoBack, changeHandler: changed),
      view.observe(\.canGoForward, changeHandler: changed),
      // Al salir de pantalla completa WebKit devuelve la vista con su propio frame: se recoloca con layout().
      view.observe(\.fullscreenState) { [weak self] view, _ in
        if view.fullscreenState == .notInFullscreen { self?.layout() }
      },
    ]
    return view
  }

  func remove(_ id: String) {
    observers[id] = nil
    // Quita los delegados para evitar notificaciones sobre la pestaña cerrada
    tabs[id]?.navigationDelegate = nil
    tabs[id]?.uiDelegate = nil
    tabs[id]?.stopLoading()
    // Carga una página vacía para detener el audio y vídeo en el WKWebView: retirarlo no basta,
    // la vista puede seguir viva un rato y su página seguía sonando.
    tabs[id]?.loadHTMLString("", baseURL: nil)
    tabs[id]?.removeFromSuperview()
    tabs[id] = nil
    if active == id { active = nil }
  }

  func unload(_ id: String) {
    remove(id)
    layout()
    send(["id": id, "unloaded": true])
  }

  func applyBlocklist(to view: WKWebView) {
    let controller = view.configuration.userContentController
    controller.removeAllContentRuleLists()
    if blocking, let trackerList { controller.add(trackerList) }
  }

  // Compila las reglas de bloqueo solo cuando cambia la versión, para ahorrar tiempo y reducir carga. Si la versión coincide,
  // reutiliza la compilación guardada; si no, solicita las reglas solo cuando es necesario, evitando enviar 5 MB en cada carga.
  func setBlocklist(enabled: Bool, version: String?, rules: String?) {
    blocking = enabled
    let applyAll = { [weak self] in
      guard let self else { return }
      self.tabs.values.forEach(self.applyBlocklist)
      self.send(["blocklist": self.blocking && self.trackerList != nil ? "on" : "off"])
    }
    guard enabled, let version else { return applyAll() }
    let store = WKContentRuleListStore.default()!
    let saved = UserDefaults.standard.string(forKey: "trackersVersion")
    if let rules {
      store.compileContentRuleList(forIdentifier: "trackers", encodedContentRuleList: rules) { [weak self] list, error in
        if let list {
          self?.trackerList = list
          UserDefaults.standard.set(version, forKey: "trackersVersion")
        } else {
          self?.send(["blocklist": "error", "message": error?.localizedDescription ?? ""])
        }
        applyAll()
      }
    } else if saved == version, trackerList != nil {
      applyAll()
    } else if saved == version {
      store.lookUpContentRuleList(forIdentifier: "trackers") { [weak self] list, _ in
        guard let list else { return self?.send(["blocklist": "need"]) ?? () }
        self?.trackerList = list
        applyAll()
      }
    } else {
      send(["blocklist": "need"])
    }
  }

  // Quita utm_* y los ids de clic. Quien llama lo aplica solo a GET del frame principal, para no romper formularios POST.
  func withoutTrackingParams(_ url: URL) -> URL? {
    guard var parts = URLComponents(url: url, resolvingAgainstBaseURL: false), let items = parts.queryItems else { return nil }
    let tracking: Set<String> = ["fbclid", "gclid", "dclid", "gbraid", "wbraid", "msclkid", "mc_eid", "mc_cid",
                                 "igshid", "yclid", "_hsenc", "_hsmi", "mkt_tok", "twclid", "ttclid", "li_fat_id"]
    let kept = items.filter { !tracking.contains($0.name.lowercased()) && !$0.name.lowercased().hasPrefix("utm_") }
    guard kept.count < items.count else { return nil }
    parts.queryItems = kept.isEmpty ? nil : kept
    return parts.url
  }

  // El rect llega en píxeles CSS con origen arriba a la izquierda: se invierte la Y si la vista
  // del panel no es flipped y se convierte al contenedor. Solo se muestra la pestaña activa, y
  // solo si el panel dice que está visible.
  func layout() {
    guard let panel, let container else { return }
    let y = panel.isFlipped ? rect.minY : panel.bounds.height - rect.maxY
    let frame = panel.convert(CGRect(x: rect.minX, y: y, width: rect.width, height: rect.height), to: container)
    // Las vistas en pantalla completa viven en la ventana de WebKit: ponerles el frame del panel las rompería.
    for (id, view) in tabs where view.fullscreenState == .notInFullscreen {
      let shown = visible && id == active && rect.width > 0 && rect.height > 0
      view.isHidden = !shown
      if shown { view.frame = frame }
    }
  }

  // Lo usa el menú: ⌘W, ⌘L, ⌘[ y ⌘] solo actúan con el foco dentro de una web; si no,
  // chocarían con Monaco (⌘[ indenta, ⌘L selecciona la línea).
  func hasFocus(in window: NSWindow?) -> Bool {
    guard let responder = window?.firstResponder as? NSView else { return false }
    return tabs.values.contains { responder === $0 || responder.isDescendant(of: $0) }
  }

  func idOf(_ view: WKWebView) -> String? { tabs.first { $0.value === view }?.key }

  func command(_ name: String) { send(["command": name]) }

  func emit(_ id: String, extra: [String: Any] = [:]) {
    guard let view = tabs[id] else { return }
    var event: [String: Any] = [
      "id": id, "title": view.title ?? "", "url": view.url?.absoluteString ?? "",
      "loading": view.isLoading, "canBack": view.canGoBack, "canForward": view.canGoForward,
    ]
    event.merge(extra) { $1 }
    send(event)
  }

  func send(_ event: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: event),
          let json = String(data: data, encoding: .utf8) else { return }
    panel?.evaluateJavaScript("window.onBrowserEvent && window.onBrowserEvent(\(json))")
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    guard let id = idOf(webView) else { return }
    let script = "(document.querySelector('link[rel~=\"icon\"]') || {}).href || (location.origin + '/favicon.ico')"
    webView.evaluateJavaScript(script) { [weak self] result, _ in
      if let icon = result as? String, icon.hasPrefix("http") { self?.emit(id, extra: ["favicon": icon]) }
    }
  }

  // Los esquemas que no son web (mailto:, zoommtg:…) se abren con su app de macOS en vez de fallar.
  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
               decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    if action.shouldPerformDownload { return decisionHandler(.download) }
    let scheme = action.request.url?.scheme?.lowercased() ?? ""
    // Clic con rueda (botón central) en enlace abre pestaña en segundo plano como Safari/Chrome; se aceptan botones 2 y 4 por compatibilidad con macOS, sin riesgo de clic derecho.
    if action.navigationType == .linkActivated, [2, 4].contains(action.buttonNumber),
       ["http", "https"].contains(scheme), let url = action.request.url {
      decisionHandler(.cancel)
      let id = "w" + UUID().uuidString.prefix(8).lowercased()
      add(id, configuration: nil).load(URLRequest(url: url))
      emit(id, extra: ["opened": true, "opener": idOf(webView) ?? "", "background": true, "url": url.absoluteString])
      return
    }
    if ["http", "https"].contains(scheme), action.targetFrame?.isMainFrame == true,
       action.request.httpMethod == "GET", let url = action.request.url, let clean = withoutTrackingParams(url) {
      decisionHandler(.cancel)
      webView.load(URLRequest(url: clean))
      return
    }
    if ["http", "https", "about", "blob", "data", "file"].contains(scheme) || scheme.isEmpty {
      decisionHandler(.allow)
    } else {
      if let url = action.request.url, action.targetFrame?.isMainFrame != false { NSWorkspace.shared.open(url) }
      decisionHandler(.cancel)
    }
  }

  // Decide si descargar o permitir una respuesta: se descarga si es attachment o si el tipo MIME no se puede mostrar, solo en el frame principal.
  func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
               decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
    let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
    let attachment = disposition.trimmingCharacters(in: .whitespaces).lowercased().hasPrefix("attachment")
    decisionHandler(response.isForMainFrame && (attachment || !response.canShowMIMEType) ? .download : .allow)
  }

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { track(download) }
  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { track(download) }

  // Registra una descarga para monitorear su progreso y enviar actualizaciones al panel, con límite de 250 ms entre envíos.
  func track(_ download: WKDownload) {
    download.delegate = self
    downloadIds[download] = "d" + UUID().uuidString.prefix(8).lowercased()
    var last = Date.distantPast
    downloadObservers[download] = download.progress.observe(\.fractionCompleted) { [weak self] progress, _ in
      DispatchQueue.main.async {
        guard let self, self.downloadPaths[download] != nil, Date().timeIntervalSince(last) > 0.25 else { return }
        last = Date()
        self.sendDownload(download, ["progress": progress.fractionCompleted, "bytes": progress.completedUnitCount])
      }
    }
  }

  // Elige el destino en ~/Downloads: evita nombres ocultos y numera como Safari si ya existe o coincide con otra descarga en curso.
  func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
    var name = (suggestedFilename as NSString).lastPathComponent
    if name.isEmpty || name.hasPrefix(".") { name = "descarga" + name }
    let base = (name as NSString).deletingPathExtension
    let ext = (name as NSString).pathExtension
    var url = downloadsDir.appendingPathComponent(name)
    var n = 1
    while FileManager.default.fileExists(atPath: url.path) || downloadPaths.values.contains(url) {
      url = downloadsDir.appendingPathComponent(ext.isEmpty ? "\(base) (\(n))" : "\(base) (\(n)).\(ext)")
      n += 1
    }
    downloadPaths[download] = url
    sendDownload(download, ["name": url.lastPathComponent, "path": url.path, "state": "running", "progress": 0])
    completionHandler(url)
  }

  // Avisa al panel del final de la descarga y hace rebotar la pila de Descargas del Dock, como Safari.
  func downloadDidFinish(_ download: WKDownload) {
    let url = downloadPaths[download]
    let bytes = url.flatMap { try? $0.resourceValues(forKeys: [.fileSizeKey]).fileSize } ?? 0
    sendDownload(download, ["state": "done", "progress": 1, "bytes": bytes])
    if let url {
      DistributedNotificationCenter.default().post(name: .init("com.apple.DownloadFileFinished"), object: url.path)
    }
    forget(download)
  }

  func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    sendDownload(download, ["state": "failed"])
    forget(download)
  }

  func forget(_ download: WKDownload) {
    downloadIds[download] = nil
    downloadPaths[download] = nil
    downloadObservers[download] = nil
  }

  func sendDownload(_ download: WKDownload, _ fields: [String: Any]) {
    guard let id = downloadIds[download] else { return }
    var event = fields
    event["id"] = id
    send(["download": event])
  }

  // Verifica si una ruta está dentro del directorio ~/Downloads, resolviendo enlaces simbólicos y comparando por componentes.
  func insideDownloads(_ value: Any?) -> URL? {
    guard let path = value as? String, !path.isEmpty else { return nil }
    let root = downloadsDir.resolvingSymlinksInPath().standardizedFileURL.pathComponents
    let url = URL(fileURLWithPath: path).resolvingSymlinksInPath().standardizedFileURL
    let parts = url.pathComponents
    guard parts.count > root.count, Array(parts.prefix(root.count)) == root,
          FileManager.default.fileExists(atPath: url.path) else { return nil }
    return url
  }

  // target=_blank y window.open abren una pestaña nueva en el panel. WebKit exige que la vista
  // devuelta se cree con la configuración que él pasa.
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
               for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    let id = "w" + UUID().uuidString.prefix(8).lowercased()
    let view = add(id, configuration: configuration)
    active = id
    layout()
    emit(id, extra: ["opened": true, "opener": idOf(webView) ?? ""])
    return view
  }

  func webViewDidClose(_ webView: WKWebView) {
    guard let id = idOf(webView) else { return }
    remove(id)
    layout()
    send(["id": id, "closed": true])
  }

  func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
               initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection
    panel.canChooseDirectories = parameters.allowsDirectories
    panel.begin { completionHandler($0 == .OK ? panel.urls : nil) }
  }

  // Solicita al usuario permiso para acceso a cámara o micrófono, evitando denegar o conceder automáticamente.
  // Requiere NSCameraUsageDescription y NSMicrophoneUsageDescription en Info.plist.
  func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
               initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
               decisionHandler: @escaping (WKPermissionDecision) -> Void) {
    decisionHandler(.prompt)
  }

  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
               initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
    let alert = NSAlert()
    alert.messageText = message
    alert.runModal()
    completionHandler()
  }

  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
               initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    let alert = NSAlert()
    alert.messageText = message
    alert.addButton(withTitle: "Aceptar")
    alert.addButton(withTitle: "Cancelar")
    completionHandler(alert.runModal() == .alertFirstButtonReturn)
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
