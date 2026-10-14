// Decide si lo que se escribe en la barra del navegador es una URL o una búsqueda
// en el buscador elegido, saca el nombre corto de un host y lleva el historial. Puro y sin estado, como split.js:
// el mismo archivo vale en el navegador y en node --test.
(function (root) {
  const SEARCH_ENGINES = {
    google: { name: "Google", url: "https://www.google.com/search?q=" },
    duckduckgo: { name: "DuckDuckGo", url: "https://duckduckgo.com/?q=" },
    bing: { name: "Bing", url: "https://www.bing.com/search?q=" },
    brave: { name: "Brave Search", url: "https://search.brave.com/search?q=" },
  };
  const SEARCH_URL = SEARCH_ENGINES.google.url;
  const DEFAULT_HOME = "https://www.google.com";

  function normalizeInput(text, engine = "google") {
    const value = String(text ?? "").trim();
    if (!value) return null;
    const search = (Object.hasOwn(SEARCH_ENGINES, engine) ? SEARCH_ENGINES[engine] : SEARCH_ENGINES.google).url;
    if (/^https?:\/\//i.test(value) || /^about:blank$/i.test(value)) return value;
    if (/\s/.test(value)) return search + encodeURIComponent(value);
    if (/^(localhost|127\.0\.0\.1|\[::1\]|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/.*)?$/i.test(value)) return `http://${value}`;
    if (/^[^/?#:]+\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(value)) return `https://${value}`;
    return search + encodeURIComponent(value);
  }

  // La página de inicio tiene que ser una dirección: una palabra suelta no se convierte en búsqueda.
  function normalizeHome(text) {
    const value = String(text ?? "").trim();
    const url = normalizeInput(value);
    return url && (url === value || !url.startsWith(SEARCH_URL)) ? url : null;
  }

  function hostLabel(url) {
    try {
      const { hostname, protocol } = new URL(url);
      if (!hostname) return protocol === "about:" ? "Nueva pestaña" : url;
      return hostname.replace(/^www\./, "");
    } catch {
      return String(url ?? "");
    }
  }

  const MAX_DOWNLOADS = 30;
  const str = (v) => (typeof v === "string" ? v : "");

  // Sanea el estado guardado en localStorage: filtra y valida datos corruptos o de versiones anteriores,
  // deja sueltas las pestañas cuya carpeta ya no existe y restaura como failed las descargas que quedaron a medias.
  function restoreState(saved) {
    const folders = (Array.isArray(saved?.folders) ? saved.folders : [])
      .filter((f) => f && typeof f.id === "string" && typeof f.name === "string")
      .map((f) => ({ id: f.id, name: f.name, open: f.open !== false }));
    const folderIds = new Set(folders.map((f) => f.id));
    const tabs = (Array.isArray(saved?.tabs) ? saved.tabs : [])
      .filter((t) => t && typeof t.id === "string" && typeof t.url === "string")
      .map((t) => ({
        id: t.id,
        url: t.url,
        title: str(t.title),
        favicon: str(t.favicon),
        pinned: Boolean(t.pinned),
        folder: folderIds.has(t.folder) ? t.folder : null,
      }));
    const downloads = (Array.isArray(saved?.downloads) ? saved.downloads : [])
      .filter((d) => d && typeof d.id === "string" && typeof d.name === "string")
      .slice(0, MAX_DOWNLOADS)
      .map((d) => ({
        id: d.id,
        name: d.name,
        path: str(d.path),
        bytes: Number.isFinite(d.bytes) ? d.bytes : 0,
        state: d.state === "done" ? "done" : "failed",
      }));
    const active = tabs.some((t) => t.id === saved?.active) ? saved.active : tabs[0]?.id || null;
    return { tabs, folders, downloads, active };
  }

  function formatBytes(n) {
    if (!Number.isFinite(n) || n <= 0) return "";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i++;
    }
    return `${i === 0 || n >= 10 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
  }

  const MAX_HISTORY = 2000;

  // Una entrada por URL: volver a visitarla la sube arriba con la hora y el título nuevos.
  function addHistory(list, url, title, at) {
    if (!/^https?:\/\//i.test(url)) return list;
    const prev = list.find((h) => h.url === url);
    const entry = { url, title: str(title) || prev?.title || "", at };
    return [entry, ...list.filter((h) => h.url !== url)].slice(0, MAX_HISTORY);
  }

  function filterHistory(list, query) {
    const q = String(query ?? "").trim().toLowerCase();
    if (!q) return list;
    return list.filter((h) => h.url.toLowerCase().includes(q) || h.title.toLowerCase().includes(q));
  }

  // since en ms: borra lo visitado desde entonces; 0 lo borra todo.
  function clearHistorySince(list, since) {
    return since > 0 ? list.filter((h) => h.at < since) : [];
  }

  function restoreHistory(saved) {
    return (Array.isArray(saved) ? saved : [])
      .filter((h) => h && typeof h.url === "string" && /^https?:\/\//i.test(h.url) && Number.isFinite(h.at))
      .slice(0, MAX_HISTORY)
      .map((h) => ({ url: h.url, title: str(h.title), at: h.at }));
  }

  function restoreSettings(saved) {
    const engine = Object.hasOwn(SEARCH_ENGINES, saved?.engine) ? saved.engine : "google";
    const home = (typeof saved?.home === "string" && normalizeHome(saved.home)) || DEFAULT_HOME;
    return { engine, home, history: saved?.history !== false };
  }

  const api = {
    normalizeInput, normalizeHome, hostLabel, restoreState, formatBytes,
    addHistory, filterHistory, clearHistorySince, restoreHistory, restoreSettings,
    SEARCH_URL, SEARCH_ENGINES, DEFAULT_HOME, MAX_DOWNLOADS, MAX_HISTORY,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BrowserUrl = api;
})(typeof window !== "undefined" ? window : globalThis);
