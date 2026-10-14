// Pestaña Navegador: la barra lateral estilo Zen (pestañas, fijadas, barra de URL).
// La web la pinta la app nativa con un WKWebView encima de #browserView; este módulo
// le dice dónde y qué cargar (webkit.messageHandlers.browser) y recibe su estado
// por window.onBrowserEvent. Fuera de la app no hay puente y solo enseña un aviso.
const Browser = (() => {
  const STORE_KEY = "dispatch.browser";
  const SETTINGS_KEY = "dispatch.browser.settings";
  const HISTORY_KEY = "dispatch.browser.history";
  const CLEAR_RANGES = [
    [3600000, "Última hora"],
    [86400000, "Últimas 24 horas"],
    [604800000, "Últimos 7 días"],
    [0, "Todo"],
  ];

  const $ = (sel) => document.querySelector(sel);
  const bridge = window.webkit?.messageHandlers?.browser;
  const post = (msg) => bridge?.postMessage(msg);

  let tabs = [];
  let folders = [];
  let downloads = [];
  let downloadsOpen = true;
  let active = null;
  let shown = false;
  let started = false;
  let blockOn = true;
  let blockState = "off";
  let blockInfo = null;
  let unloadMin = 30;
  let settings = BrowserUrl.restoreSettings(null);
  let history = [];
  let siteData = null;
  let vault = null;

  const tabOf = (id) => tabs.find((t) => t.id === id) || null;
  const newId = () => "t" + Math.random().toString(36).slice(2, 10);

  // Ids conservados a propósito: al recargar el panel, la app nativa reconoce las vistas que siguen vivas.
  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY));
      ({ tabs, folders, downloads, active } = BrowserUrl.restoreState(saved));
      downloadsOpen = saved?.downloadsOpen !== false;
      blockOn = saved?.blockOn !== false;
      unloadMin = Number.isFinite(saved?.unloadMin) ? saved.unloadMin : 30;
    } catch {
      ({ tabs, folders, downloads, active } = BrowserUrl.restoreState(null));
    }
    for (const t of tabs) t.unloaded = true;
    try {
      settings = BrowserUrl.restoreSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY)));
      history = BrowserUrl.restoreHistory(JSON.parse(localStorage.getItem(HISTORY_KEY)));
    } catch {}
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {}
  }

  function saveHistory() {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {}
  }

  // Cada emit de la vista nativa trae la URL: solo se escribe si cambió la primera entrada.
  function recordVisit(tab) {
    if (!settings.history || tab.loading) return;
    const top = history[0];
    if (top && top.url === tab.url && top.title === tab.title) return;
    const next = BrowserUrl.addHistory(history, tab.url, tab.title, Date.now());
    if (next === history) return;
    history = next;
    saveHistory();
    if (settingsShown()) renderHistory();
  }

  // ---- Ajustes: reutiliza el modal del panel, que ya oculta las vistas nativas ----
  const settingsShown = () => Boolean($("#modalBackdrop.open #modalBody .br-set"));
  const KIND_LABELS = { cookies: "cookies", cache: "caché", storage: "almacenamiento" };
  const when = (at) => new Date(at).toLocaleString("es", { dateStyle: "short", timeStyle: "short" });

  function openSettings() {
    $("#modalTitle").textContent = "Ajustes del navegador";
    const engines = Object.entries(BrowserUrl.SEARCH_ENGINES)
      .map(([id, e]) => `<option value="${id}"${id === settings.engine ? " selected" : ""}>${escapeHtml(e.name)}</option>`)
      .join("");
    const ranges = CLEAR_RANGES.map(([ms, label]) => `<option value="${ms}"${ms === 0 ? " selected" : ""}>${label}</option>`).join("");
    $("#modalBody").innerHTML = `<div class="br-set">
      <section>
        <div class="field-label">GENERAL</div>
        <label class="br-set-row"><span>Buscador</span><select id="brSetEngine">${engines}</select></label>
        <label class="br-set-row"><span>Página de inicio</span><input id="brSetHome" class="mono" value="${escapeAttr(settings.home)}" spellcheck="false"></label>
        <label class="br-set-row"><span>Guardar historial</span><input type="checkbox" id="brSetHistory"${settings.history ? " checked" : ""}></label>
        <span class="muted small" id="brSetMsg"></span>
      </section>
      <section>
        <div class="field-label">CONTRASEÑAS</div>
        <label class="br-set-row"><span>Ofrecer guardarlas</span><input type="checkbox" id="brPwOffer" checked></label>
        <input id="brPwQ" placeholder="Buscar sitio o usuario" spellcheck="false">
        <div class="br-set-list" id="brPwList"></div>
        <span class="muted small" id="brPwMsg">Van al llavero de macOS. Para rellenar, haz clic en el campo de usuario o contraseña; copiar o editar una pide Touch ID o la contraseña del Mac.</span>
      </section>
      <section>
        <div class="field-label">BORRAR DATOS DE NAVEGACIÓN</div>
        <label class="br-set-row"><span>Periodo</span><select id="brClearRange">${ranges}</select></label>
        <div class="br-set-checks">
          <label><input type="checkbox" data-kind="history" checked> Historial</label>
          <label><input type="checkbox" data-kind="cookies"> Cookies y sesiones iniciadas</label>
          <label><input type="checkbox" data-kind="cache" checked> Caché de imágenes y archivos</label>
          <label title="localStorage, IndexedDB, service workers… Solo se borra con el periodo «Todo»"><input type="checkbox" data-kind="storage"> Almacenamiento de sitios</label>
        </div>
        <div class="row"><button class="btn primary" id="brClearBtn">Borrar</button><span class="muted small" id="brClearMsg"></span></div>
      </section>
      <section>
        <div class="field-label">HISTORIAL</div>
        <input id="brHistQ" placeholder="Buscar en el historial" spellcheck="false">
        <div class="br-set-list" id="brHistList"></div>
      </section>
      <section>
        <div class="field-label">DATOS POR SITIO</div>
        <input id="brSiteQ" placeholder="Buscar sitio" spellcheck="false">
        <div class="br-set-list" id="brSiteList"></div>
        <span class="muted small">Los datos del panel (localhost) no salen aquí ni se borran desde aquí.</span>
      </section>
    </div>`;
    $("#modalBackdrop").classList.add("open");
    syncRange();
    renderHistory();
    siteData = null;
    renderSites();
    post({ op: "siteData" });
    vault = null;
    renderPasswords();
    post({ op: "passwords" });
  }

  // Del llavero solo llegan origen y usuario: la contraseña nunca pasa por el panel.
  function renderPasswords() {
    const box = $("#brPwList");
    if (!box) return;
    if (!bridge) return void (box.innerHTML = `<div class="muted small">Solo dentro de la app Singularity.</div>`);
    if (!vault) return void (box.innerHTML = `<div class="muted small">Cargando…</div>`);
    $("#brPwOffer").checked = vault.offer;
    const q = $("#brPwQ").value.trim().toLowerCase();
    const attrs = (origin, account) => `data-origin="${escapeAttr(origin)}" data-account="${escapeAttr(account)}"`;
    const saved = vault.passwords
      .filter((p) => p.origin.toLowerCase().includes(q) || p.account.toLowerCase().includes(q))
      .sort((a, b) => a.origin.localeCompare(b.origin) || a.account.localeCompare(b.account))
      .map((p) => `<div class="br-set-item">
          <span class="br-title">${escapeHtml(BrowserUrl.hostLabel(p.origin))}<span class="muted"> · ${escapeHtml(p.account || "(sin usuario)")}</span></span>
          <button class="btn" data-pwcopy ${attrs(p.origin, p.account)}>Copiar</button>
          <button class="btn" data-pwedit ${attrs(p.origin, p.account)}>Editar</button>
          <button class="br-close" data-pwdel ${attrs(p.origin, p.account)} title="Borrar del llavero">×</button>
        </div>`);
    const never = vault.never
      .filter((o) => o.toLowerCase().includes(q))
      .map((o) => `<div class="br-set-item">
          <span class="br-title muted">Nunca se guarda en ${escapeHtml(BrowserUrl.hostLabel(o))}</span>
          <button class="btn" data-pwnever="${escapeAttr(o)}">Quitar</button>
        </div>`);
    box.innerHTML = saved.length + never.length
      ? [...saved, ...never].join("")
      : `<div class="muted small">${vault.passwords.length ? "Nada coincide." : "Aún no hay contraseñas guardadas."}</div>`;
  }

  // El almacenamiento no admite rango: ver clearData en Singularity.swift.
  function syncRange() {
    const storage = $('#modalBody [data-kind="storage"]');
    const ranged = Number($("#brClearRange").value) > 0;
    storage.disabled = ranged;
    if (ranged) storage.checked = false;
  }

  function renderHistory() {
    const list = BrowserUrl.filterHistory(history, $("#brHistQ")?.value).slice(0, 200);
    $("#brHistList").innerHTML = list.length
      ? list
          .map((h) => `<div class="br-set-item" data-hist="${escapeAttr(h.url)}" title="${escapeAttr(h.url)}">
              <span class="br-title">${escapeHtml(h.title || BrowserUrl.hostLabel(h.url))}<span class="muted"> · ${escapeHtml(BrowserUrl.hostLabel(h.url))}</span></span>
              <span class="muted small">${when(h.at)}</span>
              <button class="br-close" data-histdel="${escapeAttr(h.url)}" title="Quitar del historial">×</button>
            </div>`)
          .join("")
      : `<div class="muted small">${history.length ? "Nada coincide." : settings.history ? "Aún no hay historial." : "El historial está desactivado."}</div>`;
  }

  function renderSites() {
    const box = $("#brSiteList");
    if (!box) return;
    if (!bridge) return void (box.innerHTML = `<div class="muted small">Solo dentro de la app Singularity.</div>`);
    if (!siteData) return void (box.innerHTML = `<div class="muted small">Cargando…</div>`);
    const q = $("#brSiteQ").value.trim().toLowerCase();
    const list = siteData.filter((s) => s.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
    box.innerHTML = list.length
      ? list
          .map((s) => `<div class="br-set-item">
              <span class="br-title">${escapeHtml(s.name)}</span>
              <span class="muted small">${s.kinds.map((k) => KIND_LABELS[k] || k).join(", ")}</span>
              <button class="btn" data-site="${escapeAttr(s.name)}"${s.pending ? " disabled" : ""}>${s.pending ? "Borrando…" : "Eliminar"}</button>
            </div>`)
          .join("")
      : `<div class="muted small">${siteData.length ? "Nada coincide." : "Ningún sitio guarda datos."}</div>`;
  }

  function clearBrowsingData() {
    const kinds = [...document.querySelectorAll("#modalBody [data-kind]:checked")].map((el) => el.dataset.kind);
    if (!kinds.length) return;
    const range = Number($("#brClearRange").value);
    if ((kinds.includes("cookies") || kinds.includes("storage")) && !confirm("Se cerrará tu sesión en los sitios afectados. ¿Borrar?")) return;
    const since = range ? Date.now() - range : 0;
    if (kinds.includes("history")) {
      history = BrowserUrl.clearHistorySince(history, since);
      saveHistory();
      renderHistory();
    }
    const native = kinds.filter((k) => k !== "history");
    if (!native.length || !bridge) return void ($("#brClearMsg").textContent = "Listo.");
    $("#brClearBtn").disabled = true;
    $("#brClearMsg").textContent = "Borrando…";
    post({ op: "clearData", kinds: native, since });
  }

  function onSettingsChange(e) {
    if (e.target.id === "brPwOffer") return post({ op: "passwordsOffer", enabled: e.target.checked });
    if (e.target.id === "brSetEngine") settings.engine = e.target.value;
    else if (e.target.id === "brSetHistory") settings.history = e.target.checked;
    else if (e.target.id === "brSetHome") {
      const home = BrowserUrl.normalizeHome(e.target.value);
      $("#brSetMsg").textContent = home ? "" : "La página de inicio tiene que ser una dirección, como google.com.";
      if (!home) return;
      settings.home = e.target.value = home;
    } else if (e.target.id === "brClearRange") return syncRange();
    else return;
    saveSettings();
  }

  function onSettingsClick(e) {
    if (!e.target.closest(".br-set")) return;
    if (e.target.closest("#brClearBtn")) return clearBrowsingData();
    const pw = e.target.closest("[data-pwcopy], [data-pwedit], [data-pwdel]");
    if (pw) {
      const { origin, account } = pw.dataset;
      if (pw.hasAttribute("data-pwcopy")) return post({ op: "passwordCopy", origin, account });
      if (pw.hasAttribute("data-pwedit")) return post({ op: "passwordEdit", origin, account });
      if (!confirm(`¿Borrar del llavero la contraseña de ${account || "(sin usuario)"} en ${BrowserUrl.hostLabel(origin)}?`)) return;
      return post({ op: "passwordDelete", origin, account });
    }
    const never = e.target.closest("[data-pwnever]");
    if (never) return post({ op: "passwordNeverRemove", origin: never.dataset.pwnever });
    const del = e.target.closest("[data-histdel]");
    if (del) {
      history = history.filter((h) => h.url !== del.dataset.histdel);
      saveHistory();
      return renderHistory();
    }
    const site = e.target.closest("[data-site]");
    if (site) {
      const entry = siteData?.find((s) => s.name === site.dataset.site);
      if (!entry || !confirm(`Se borrarán las cookies y los datos de ${entry.name}. ¿Seguir?`)) return;
      entry.pending = true;
      renderSites();
      return post({ op: "clearSite", name: entry.name });
    }
    const hist = e.target.closest("[data-hist]");
    if (hist) {
      $("#modalBackdrop").classList.remove("open");
      newTab(hist.dataset.hist);
    }
  }

  // Solo lo necesario para reabrir; loading, canBack y canForward son del momento.
  function save() {
    try {
      const keep = tabs.map(({ id, url, title, favicon, pinned, folder }) => ({ id, url, title, favicon, pinned, folder }));
      const dls = downloads.map(({ id, name, path, bytes, state }) => ({ id, name, path, bytes, state }));
      localStorage.setItem(STORE_KEY, JSON.stringify({ tabs: keep, folders, downloads: dls, downloadsOpen, active, blockOn, unloadMin }));
    } catch {}
  }

  // La vista nativa va encima del HTML: con el modal del panel abierto se oculta, o lo taparía.
  // Se manda en cada cambio de tamaño, también al arrastrar el divisor de la pantalla dividida.
  function sendFrame() {
    const view = $("#browserView");
    const modalOpen = $("#modalBackdrop")?.classList.contains("open");
    const r = view?.getBoundingClientRect();
    const visible = Boolean(shown && !modalOpen && r && r.width > 0 && r.height > 0 && active);
    post({ op: "frame", visible, rect: r ? { x: r.left, y: r.top, width: r.width, height: r.height } : null });
  }

  // Letra inicial del host debajo; el favicon la tapa y, si no carga, se quita.
  function iconHtml(tab) {
    const letter = BrowserUrl.hostLabel(tab.url).charAt(0).toUpperCase() || "·";
    const img = tab.favicon ? `<img src="${escapeAttr(tab.favicon)}" alt="" onerror="this.remove()">` : "";
    return `<span class="br-ico" data-letter="${escapeAttr(letter)}">${img}</span>`;
  }

  function render() {
    const pins = tabs.filter((t) => t.pinned);
    const rest = tabs.filter((t) => !t.pinned);
    $("#brPins").innerHTML = pins
      .map((t) => `<button class="br-pin${t.id === active ? " active" : ""}${t.unloaded ? " unloaded" : ""}" data-id="${t.id}" title="${escapeAttr(t.title || t.url)}">${iconHtml(t)}</button>`)
      .join("");
    const tabHtml = (t) => `<div class="br-tab${t.id === active ? " active" : ""}${t.loading ? " loading" : ""}${t.unloaded ? " unloaded" : ""}" data-id="${t.id}" draggable="true" title="${escapeAttr(t.url)}">
          ${iconHtml(t)}<span class="br-title">${escapeHtml(t.title || BrowserUrl.hostLabel(t.url))}</span>
          <button class="br-close" data-close="${t.id}" title="Cerrar pestaña (⌘W)">×</button>
        </div>`;
    const folderHtml = (f) => {
      const inside = rest.filter((t) => t.folder === f.id);
      return `<div class="br-folder${f.open ? " open" : ""}" data-folder="${f.id}">
          <div class="br-folder-head" data-toggle="${f.id}" title="Clic: plegar · doble clic: renombrar">
            <span class="br-chev">${f.open ? "▾" : "▸"}</span><span class="br-title">${escapeHtml(f.name)}</span>
            <span class="br-count">${inside.length || ""}</span>
            <button class="br-close" data-delfolder="${f.id}" title="Quitar carpeta (las pestañas quedan sueltas)">×</button>
          </div>
          ${f.open ? `<div class="br-folder-body">${inside.map(tabHtml).join("")}</div>` : ""}
        </div>`;
    };
    $("#brTabs").innerHTML =
      folders.map(folderHtml).join("") +
      rest.filter((t) => !t.folder).map(tabHtml).join("");
    renderDownloads();
    const shield = $("#brShield");
    shield.classList.toggle("on", blockState === "on");
    shield.title =
      blockState === "on"
        ? `Bloqueando rastreadores (${blockInfo?.count ?? "?"} reglas de EasyPrivacy). Clic: desactivar`
        : blockState === "error"
          ? "No se pudo activar el bloqueo de rastreadores. Clic: reintentar"
          : blockOn
            ? "Preparando el bloqueo de rastreadores…"
            : "Bloqueo de rastreadores desactivado. Clic: activar";
    $("#brUnloadMin").value = unloadMin;
    const tab = tabOf(active);
    const url = $("#brUrl");
    if (document.activeElement !== url) url.value = tab && tab.url !== "about:blank" ? tab.url : "";
    $("#brBack").disabled = !tab?.canBack;
    $("#brForward").disabled = !tab?.canForward;
    $("#brReload").textContent = tab?.loading ? "×" : "↻";
    $("#brReload").title = tab?.loading ? "Detener" : "Recargar";
    $("#brEmpty").hidden = Boolean(bridge && tab);
    $("#brEmpty").textContent = bridge ? "Sin pestañas abiertas. Crea una con + Nueva pestaña o ⌘T." : "El navegador solo funciona dentro de la app Singularity.";
  }

  function changed() {
    save();
    render();
    sendFrame();
  }

  // Reabre una pestaña descargada con su URL al seleccionarla.
  function activate(id) {
    const tab = tabOf(id);
    if (!tab) return;
    if (tab.unloaded) {
      tab.unloaded = false;
      post({ op: "open", id, url: tab.url, select: true });
    }
    tab.lastSeen = Date.now();
    post({ op: "select", id });
  }

  function select(id) {
    if (!tabOf(id)) return;
    const prev = tabOf(active);
    if (prev) prev.lastSeen = Date.now();
    active = id;
    activate(id);
    changed();
  }

  function unloadTab(id, auto = false) {
    const tab = tabOf(id);
    if (!tab || tab.unloaded || id === active) return;
    post({ op: "unload", id, auto });
  }

  // Descarga las pestañas no activas que llevan más de unloadMin minutos sin verse. Si unloadMin es 0, se desactiva.
  function unloadIdle() {
    if (!unloadMin) return;
    const limit = Date.now() - unloadMin * 60000;
    for (const t of tabs) if (!t.unloaded && t.id !== active && (t.lastSeen || 0) < limit) unloadTab(t.id, true);
  }

  // Sincroniza la lista de bloqueo con la app nativa: primero envía solo la versión, y solo si no tiene reglas compiladas
  // se piden las reglas (5 MB).
  async function syncBlocklist(withRules = false) {
    if (!bridge) return;
    if (!blockOn) return post({ op: "blocklist", enabled: false });
    try {
      const res = await fetch(`/api/browser/blocklist${withRules ? "?rules=1" : ""}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      blockInfo = { count: data.count, version: data.version };
      post({ op: "blocklist", enabled: true, version: data.version, rules: data.rules });
    } catch {
      blockState = "error";
      render();
    }
  }

  function tabMenu(item) {
    const tab = tabOf(item.dataset.id);
    if (!tab) return;
    openGitMenu(item, [
      { label: tab.pinned ? "Desfijar" : "Fijar", onPick: () => togglePin(tab.id) },
      ...(tab.unloaded || tab.id === active ? [] : [{ label: "Descargar de memoria", onPick: () => unloadTab(tab.id) }]),
      { label: "Cerrar", hint: "⌘W", onPick: () => closeTab(tab.id) },
    ]);
  }

  function newTab(url = "about:blank") {
    if (!bridge) return;
    const tab = { id: newId(), url, title: "", favicon: "", pinned: false };
    tabs.push(tab);
    active = tab.id;
    post({ op: "open", id: tab.id, url, select: true });
    changed();
    if (url === "about:blank") focusUrl();
  }

  function closeTab(id) {
    const index = tabs.findIndex((t) => t.id === id);
    if (index < 0) return;
    tabs.splice(index, 1);
    post({ op: "close", id });
    if (active === id) {
      active = (tabs[index] || tabs[index - 1])?.id || null;
      if (active) activate(active);
    }
    changed();
  }

  function togglePin(id) {
    const tab = tabOf(id);
    if (!tab) return;
    tab.pinned = !tab.pinned;
    changed();
  }

  // Crea una nueva carpeta con nombre ingresado por el usuario; si no se ingresa nombre, no se crea.
  function newFolder() {
    const name = prompt("Nombre de la carpeta", "Nueva carpeta")?.trim();
    if (!name) return;
    folders.push({ id: "f" + Math.random().toString(36).slice(2, 10), name, open: true });
    changed();
  }

  // Permite renombrar una carpeta existente mediante prompt; actualiza el nombre si se ingresa uno válido.
  function renameFolder(id) {
    const folder = folders.find((f) => f.id === id);
    const name = folder && prompt("Nombre de la carpeta", folder.name)?.trim();
    if (!name) return;
    folder.name = name;
    changed();
  }

  // Elimina una carpeta; sus pestañas no se cierran, quedan sueltas.
  function deleteFolder(id) {
    folders = folders.filter((f) => f.id !== id);
    for (const t of tabs) if (t.folder === id) t.folder = null;
    changed();
  }

  // Cambia el estado de apertura/cierre de una carpeta, mostrando u ocultando sus pestañas.
  function toggleFolder(id) {
    const folder = folders.find((f) => f.id === id);
    if (!folder) return;
    folder.open = !folder.open;
    changed();
  }

  // Mueve una pestaña a una carpeta (o la saca, con folderId null) y notifica el cambio.
  function moveToFolder(tabId, folderId) {
    const tab = tabOf(tabId);
    if (!tab || tab.folder === folderId) return;
    tab.folder = folderId;
    changed();
  }

  // Actualiza la lista de descargas mostrando el progreso, estado y ruta, con elementos visuales según el estado.
  function renderDownloads() {
    const list = $("#brDlList");
    $("#brDl").classList.toggle("open", downloadsOpen);
    $("#brDlCount").textContent = downloads.length || "";
    list.innerHTML = downloads.length
      ? downloads
          .map((d) => {
            const pct = Math.round((d.progress || 0) * 100);
            const meta =
              d.state === "running"
                ? `<span class="br-bar" style="--p:${pct}%"></span>`
                : `<span class="br-dl-meta">${d.state === "failed" ? "Falló" : BrowserUrl.formatBytes(d.bytes)}</span>`;
            return `<div class="br-dl-item ${d.state}" data-dl="${escapeAttr(d.id)}" title="${escapeAttr(d.path || d.name)}">
                <span class="br-dl-name">${escapeHtml(d.name)}</span>${meta}
                ${d.state === "done" ? `<button class="br-close" data-reveal="${escapeAttr(d.id)}" title="Mostrar en Finder">⌕</button>` : ""}
              </div>`;
          })
          .join("")
      : `<div class="muted small br-dl-empty">Lo que descargues aparece aquí.</div>`;
  }

  // Maneja un evento de descarga de la app nativa: crea o actualiza su fila y abre la sección si es nueva.
  // Un evento sin nombre es una descarga que falló antes de elegir destino y se ignora.
  function onDownload(d) {
    let item = downloads.find((x) => x.id === d.id);
    if (!item) {
      if (!d.name) return;
      item = { id: d.id, name: "", path: "", bytes: 0, state: "running", progress: 0 };
      downloads.unshift(item);
      downloads.length = Math.min(downloads.length, BrowserUrl.MAX_DOWNLOADS);
      downloadsOpen = true;
    }
    for (const key of ["name", "path", "bytes", "state", "progress"]) if (d[key] !== undefined) item[key] = d[key];
    changed();
  }

  function focusUrl() {
    const url = $("#brUrl");
    url.focus();
    url.select();
  }

  // Maneja el texto de la barra de URL: lo normaliza y navega; sin pestaña activa abre una nueva.
  function go(text) {
    const url = BrowserUrl.normalizeInput(text, settings.engine);
    if (!url) return;
    if (!tabOf(active)) return newTab(url);
    tabOf(active).url = url;
    post({ op: "go", id: active, url });
    changed();
  }

  // Eventos de la app nativa. event.command llega de los atajos del menú (⌘T, ⌘W, ⌘L), porque
  // con el foco dentro de la web el JS del panel no ve esas teclas. event.opened es una pestaña
  // que abrió la propia web (target=_blank) y va justo después de la que la abrió.
  window.onBrowserEvent = (event) => {
    if (event.command) {
      if (event.command === "new") newTab();
      else if (event.command === "close" && active) closeTab(active);
      else if (event.command === "focusUrl") focusUrl();
      return;
    }
    if (event.download) return onDownload(event.download);
    if (event.passwords) {
      vault = { passwords: event.passwords, never: event.never || [], offer: event.offer !== false };
      return renderPasswords();
    }
    if (event.passwordsChanged) return void (settingsShown() && post({ op: "passwords" }));
    if (event.passwordCopied) {
      const msg = $("#brPwMsg");
      if (msg) msg.textContent = "Copiada. Se borra del portapapeles en un minuto si no copias otra cosa.";
      return;
    }
    if (event.siteData) {
      siteData = event.siteData;
      return renderSites();
    }
    if (event.siteCleared) {
      siteData = siteData?.filter((s) => s.name !== event.siteCleared) || null;
      return renderSites();
    }
    if (event.dataCleared) {
      if (!settingsShown()) return;
      $("#brClearBtn").disabled = false;
      $("#brClearMsg").textContent = "Listo.";
      return post({ op: "siteData" });
    }
    if (event.alive) {
      for (const t of tabs) if (event.alive.includes(t.id)) Object.assign(t, { unloaded: false, lastSeen: Date.now() });
      if (active) activate(active);
      return changed();
    }
    if (event.blocklist) {
      if (event.blocklist === "need") return syncBlocklist(true);
      blockState = event.blocklist;
      return render();
    }
    if (event.unloaded) {
      const t = tabOf(event.id);
      if (t) Object.assign(t, { unloaded: true, loading: false });
      return changed();
    }
    if (event.closed) {
      const index = tabs.findIndex((t) => t.id === event.id);
      if (index >= 0) tabs.splice(index, 1);
      if (active === event.id) active = tabs[Math.max(0, index - 1)]?.id || null;
      if (active) activate(active);
      return changed();
    }
    let tab = tabOf(event.id);
    if (!tab) {
      if (!event.opened) return;
      const at = tabs.findIndex((t) => t.id === event.opener);
      tab = { id: event.id, url: event.url || "about:blank", title: "", favicon: "", pinned: false };
      tabs.splice(at >= 0 ? at + 1 : tabs.length, 0, tab);
      if (!event.background) active = tab.id;
    }
    if (event.url) tab.url = event.url;
    if (event.title !== undefined) tab.title = event.title;
    if (event.favicon) tab.favicon = event.favicon;
    tab.loading = event.loading;
    tab.canBack = event.canBack;
    tab.canForward = event.canForward;
    recordVisit(tab);
    changed();
  };

  function start() {
    started = true;
    load();
    post({ op: "alive" });
    syncBlocklist();
    setInterval(unloadIdle, 60000);

    $("#brNew").addEventListener("click", () => newTab());
    $("#brNewFolder").addEventListener("click", newFolder);
    $("#brSettings").addEventListener("click", openSettings);
    $("#modalBody").addEventListener("click", onSettingsClick);
    $("#modalBody").addEventListener("change", onSettingsChange);
    $("#modalBody").addEventListener("input", (e) => {
      if (e.target.id === "brHistQ") renderHistory();
      else if (e.target.id === "brSiteQ") renderSites();
      else if (e.target.id === "brPwQ") renderPasswords();
    });
    $("#brDlToggle").addEventListener("click", () => {
      downloadsOpen = !downloadsOpen;
      changed();
    });
    $("#brShield").addEventListener("click", () => {
      blockOn = blockState === "error" ? true : !blockOn;
      blockState = "off";
      changed();
      syncBlocklist();
    });
    $("#brUnloadMin").addEventListener("change", (e) => {
      unloadMin = Math.max(0, Math.min(1440, Math.round(Number(e.target.value)) || 0));
      changed();
    });
    $("#brDlFolder").addEventListener("click", () => post({ op: "openDownloads" }));
    $("#brDlClear").addEventListener("click", () => {
      downloads = downloads.filter((d) => d.state === "running");
      changed();
    });
    $("#brDlList").addEventListener("click", (e) => {
      const reveal = e.target.closest("[data-reveal]");
      const item = downloads.find((d) => d.id === (reveal?.dataset.reveal || e.target.closest("[data-dl]")?.dataset.dl));
      if (!item?.path || item.state !== "done") return;
      post({ op: reveal ? "revealDownload" : "openDownload", path: item.path });
    });
    $("#brBack").addEventListener("click", () => post({ op: "back", id: active }));
    $("#brForward").addEventListener("click", () => post({ op: "forward", id: active }));
    $("#brReload").addEventListener("click", () => post({ op: tabOf(active)?.loading ? "stop" : "reload", id: active }));
    $("#brUrl").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        go(e.target.value);
        e.target.blur();
      } else if (e.key === "Escape") {
        e.target.blur();
        render();
      }
    });
    const side = $("#tab-navegador .br-side");
    side.addEventListener("click", (e) => {
      const close = e.target.closest("[data-close]");
      if (close) return closeTab(close.dataset.close);
      const del = e.target.closest("[data-delfolder]");
      if (del) return deleteFolder(del.dataset.delfolder);
      const head = e.target.closest("[data-toggle]");
      if (head) return toggleFolder(head.dataset.toggle);
      const item = e.target.closest("[data-id]");
      if (item) select(item.dataset.id);
    });
    side.addEventListener("dblclick", (e) => {
      const head = e.target.closest("[data-toggle]");
      if (head && !e.target.closest("button")) renameFolder(head.dataset.toggle);
    });

    const list = $("#brTabs");
    // Define un tipo MIME único para evitar que se detecten archivos o texto arrastrados desde fuera del panel.
    const DRAG_TYPE = "text/x-br-tab";
    let dropTarget = null;
    const setDrop = (el) => {
      if (dropTarget === el) return;
      dropTarget?.classList.remove("drop");
      dropTarget = el;
      el?.classList.add("drop");
    };
    list.addEventListener("dragstart", (e) => {
      const item = e.target.closest(".br-tab[data-id]");
      if (!item) return;
      e.dataTransfer.setData(DRAG_TYPE, item.dataset.id);
      e.dataTransfer.effectAllowed = "move";
    });
    list.addEventListener("dragover", (e) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      setDrop(e.target.closest("[data-folder]") || list);
    });
    list.addEventListener("dragleave", (e) => {
      if (!list.contains(e.relatedTarget)) setDrop(null);
    });
    list.addEventListener("drop", (e) => {
      const id = e.dataTransfer.getData(DRAG_TYPE);
      const folder = e.target.closest("[data-folder]")?.dataset.folder || null;
      setDrop(null);
      if (!id) return;
      e.preventDefault();
      moveToFolder(id, folder);
    });
    list.addEventListener("dragend", () => setDrop(null));

    side.addEventListener("auxclick", (e) => {
      const item = e.target.closest(".br-tab[data-id]");
      if (item && e.button === 1) closeTab(item.dataset.id);
    });
    side.addEventListener("contextmenu", (e) => {
      const item = e.target.closest("[data-id]");
      if (!item) return;
      e.preventDefault();
      tabMenu(item);
    });
// El caso contrario al del menú nativo: ⌘T y ⌘L con el foco en el panel.
    window.addEventListener("keydown", (e) => {
      if (!shown || !e.metaKey) return;
      const key = e.key.toLowerCase();
      if (key === "t") newTab();
      else if (key === "l") focusUrl();
      else return;
      e.preventDefault();
    });

    new ResizeObserver(sendFrame).observe($("#browserView"));
    window.addEventListener("resize", sendFrame);
    new MutationObserver(sendFrame).observe($("#modalBackdrop"), { attributes: true, attributeFilter: ["class"] });
    render();
  }

  // Arranca perezoso la primera vez que la pestaña se ve; sin pestañas, abre la página de inicio.
  function setVisible(visible) {
    if (visible && !started) start();
    shown = visible;
    if (visible && bridge && !tabs.length) newTab(settings.home);
    if (started) requestAnimationFrame(sendFrame);
  }

// app.js llama a showTab antes de que cargue este archivo: si la pestaña ya está a la vista, se arranca aquí.
  if (document.querySelector("#tab-navegador:is(.active, .side)")) setVisible(true);

  return { setVisible, newTab, closeTab, select };
})();
