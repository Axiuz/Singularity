const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeInput, hostLabel, restoreState, formatBytes, SEARCH_URL, MAX_DOWNLOADS } = require("../public/browserurl.js");

describe("normalizeInput", () => {
  it("devuelve null para entrada vacía o solo espacios", () => {
    assert.deepEqual(normalizeInput(""), null);
    assert.deepEqual(normalizeInput("   "), null);
    assert.deepEqual(normalizeInput(null), null);
  });

  it("devuelve la URL original si es http(s):// o about:blank", () => {
    assert.deepEqual(normalizeInput("https://example.com"), "https://example.com");
    assert.deepEqual(normalizeInput("http://localhost:3000/path"), "http://localhost:3000/path");
    assert.deepEqual(normalizeInput("about:blank"), "about:blank");
    assert.deepEqual(normalizeInput("  https://example.com  "), "https://example.com");
  });

  it("con espacios devuelve búsqueda con SEARCH_URL + encodeURIComponent", () => {
    assert.deepEqual(normalizeInput("react tutorial"), "https://www.google.com/search?q=react%20tutorial");
  });

  it("con localhost, localhost:port o IP devuelve http://", () => {
    assert.deepEqual(normalizeInput("localhost"), "http://localhost");
    assert.deepEqual(normalizeInput("localhost:5173"), "http://localhost:5173");
    assert.deepEqual(normalizeInput("127.0.0.1:3000"), "http://127.0.0.1:3000");
    assert.deepEqual(normalizeInput("[::1]"), "http://[::1]");
    assert.deepEqual(normalizeInput("localhost:5173/ruta"), "http://localhost:5173/ruta");
    assert.deepEqual(normalizeInput("192.168.1.10"), "http://192.168.1.10");
  });

  it("con dominio con punto devuelve https://", () => {
    assert.deepEqual(normalizeInput("github.com"), "https://github.com");
    assert.deepEqual(normalizeInput("docs.python.org/3/"), "https://docs.python.org/3/");
    assert.deepEqual(normalizeInput("example.com:8080"), "https://example.com:8080");
  });

  it("con palabra sin punto (como 'react') devuelve búsqueda", () => {
    assert.deepEqual(normalizeInput("react"), "https://www.google.com/search?q=react");
  });

  it("con caracteres especiales como 'ñandú' devuelve búsqueda", () => {
    assert.deepEqual(normalizeInput("ñandú"), SEARCH_URL + encodeURIComponent("ñandú"));
  });
});

describe("hostLabel", () => {
  it("quita www. del hostname", () => {
    assert.deepEqual(hostLabel("https://www.example.com"), "example.com");
    assert.deepEqual(hostLabel("http://www.google.com"), "google.com");
  });

  it("devuelve 'Nueva pestaña' para about:blank", () => {
    assert.deepEqual(hostLabel("about:blank"), "Nueva pestaña");
  });

  it("devuelve el texto original si no es una URL", () => {
    assert.deepEqual(hostLabel("react"), "react");
    assert.deepEqual(hostLabel("https://example.com/path?query=1"), "example.com");
    assert.deepEqual(hostLabel("invalid-url"), "invalid-url");
  });

  it("devuelve cadena vacía para null", () => {
    assert.deepEqual(hostLabel(null), "");
  });

  it("devuelve el hostname de una URL válida", () => {
    assert.deepEqual(hostLabel("https://sub.domain.com"), "sub.domain.com");
    assert.deepEqual(hostLabel("http://example.org:8080"), "example.org");
  });
});


describe("restoreState", () => {
  it("devuelve estado vacío cuando saved es null", () => {
    const result = restoreState(null);
    assert.deepEqual(result, { tabs: [], folders: [], downloads: [], active: null });
  });

  it("devuelve estado vacío cuando saved es undefined", () => {
    const result = restoreState(undefined);
    assert.deepEqual(result, { tabs: [], folders: [], downloads: [], active: null });
  });

  it("devuelve estado vacío cuando saved no es objeto", () => {
    const result = restoreState(123);
    assert.deepEqual(result, { tabs: [], folders: [], downloads: [], active: null });
  });

  it("descarta tabs inválidos (sin id o sin url)", () => {
    const saved = { tabs: [{ id: "1", url: null }, { id: "2", url: "https://a.com" }, { id: "3", url: "https://b.com", title: "t", favicon: "f", pinned: true, folder: "100" }] };
    const result = restoreState(saved);
    assert.deepEqual(result.tabs, [
      { id: "2", url: "https://a.com", title: "", favicon: "", pinned: false, folder: null },
      { id: "3", url: "https://b.com", title: "t", favicon: "f", pinned: true, folder: null },
    ]);
  });

  it("descarta folders inválidos (sin id o sin name)", () => {
    const saved = { folders: [{ id: "1", name: null }, { id: "2", name: "f" }, { id: "3", name: "f2" }] };
    const result = restoreState(saved);
    assert.deepEqual(result.folders, [{ id: "2", name: "f", open: true }, { id: "3", name: "f2", open: true }]);
  });

  it("asigna folder null si el id no existe en folders", () => {
    const saved = { folders: [{ id: "1", name: "f1" }], tabs: [{ id: "2", url: "https://a.com", folder: "2" }] };
    const result = restoreState(saved);
    assert.deepEqual(result.tabs[0].folder, null);
  });

  it("asigna open a true por defecto, false si es false", () => {
    const saved = { folders: [{ id: "1", name: "f1", open: false }, { id: "2", name: "f2", open: 0 }] };
    const result = restoreState(saved);
    assert.deepEqual(result.folders.map((f) => f.open), [false, true]);
  });

  it("active inexistente cae a la primera pestaña o null", () => {
    const saved = { tabs: [{ id: "1", url: "https://a.com" }, { id: "2", url: "https://b.com" }], active: "3" };
    const result = restoreState(saved);
    assert.deepEqual(result.active, "1");
  });

  it("active inexistente cae a null si no hay pestañas", () => {
    const saved = { tabs: [], active: "1" };
    const result = restoreState(saved);
    assert.deepEqual(result.active, null);
  });

  it("downloads se cortan a MAX_DOWNLOADS", () => {
    const saved = { downloads: Array.from({ length: 35 }, (_, i) => ({ id: `d${i}`, name: `n${i}`, path: "", bytes: i * 1024 })) };
    const result = restoreState(saved);
    assert.equal(result.downloads.length, MAX_DOWNLOADS);
    assert.equal(result.downloads[0].id, "d0");
  });

  it("state distinto de 'done' pasa a 'failed'", () => {
    const saved = { downloads: [{ id: "1", name: "file", path: "", bytes: 1024, state: "running" }] };
    const result = restoreState(saved);
    assert.deepEqual(result.downloads[0].state, "failed");
  });

  it("bytes no finito pasa a 0", () => {
    const saved = { downloads: [{ id: "1", name: "file", path: "", bytes: NaN }] };
    const result = restoreState(saved);
    assert.deepEqual(result.downloads[0].bytes, 0);
  });
});

describe("formatBytes", () => {
  it("devuelve cadena vacía para valores no finitos o negativos", () => {
    assert.equal(formatBytes(NaN), "");
    assert.equal(formatBytes(-1), "");
    assert.equal(formatBytes(0), "");
  });

  it("formatea con una cifra decimal por debajo de 10 y entera por encima", () => {
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(1536), "1.5 KB");
    assert.equal(formatBytes(10240), "10 KB");
    assert.equal(formatBytes(1048576), "1.0 MB");
  });
});

describe("buscador y página de inicio", () => {
  const { normalizeHome, restoreSettings, SEARCH_ENGINES, DEFAULT_HOME } = require("../public/browserurl.js");

  it("busca con el buscador elegido y cae a Google si no existe", () => {
    assert.equal(normalizeInput("hola mundo", "duckduckgo"), SEARCH_ENGINES.duckduckgo.url + "hola%20mundo");
    assert.equal(normalizeInput("react", "brave"), SEARCH_ENGINES.brave.url + "react");
    assert.equal(normalizeInput("react", "toString"), SEARCH_URL + "react");
    assert.equal(normalizeInput("github.com", "bing"), "https://github.com");
  });

  it("la página de inicio solo admite direcciones", () => {
    assert.equal(normalizeHome("github.com"), "https://github.com");
    assert.equal(normalizeHome("https://www.google.com/search?q=x"), "https://www.google.com/search?q=x");
    assert.equal(normalizeHome("about:blank"), "about:blank");
    assert.equal(normalizeHome("palabra"), null);
    assert.equal(normalizeHome("dos palabras"), null);
    assert.equal(normalizeHome(""), null);
  });

  it("restoreSettings sanea lo guardado", () => {
    assert.deepEqual(restoreSettings(null), { engine: "google", home: DEFAULT_HOME, history: true });
    assert.deepEqual(restoreSettings({ engine: "brave", home: "duckduckgo.com", history: false }),
      { engine: "brave", home: "https://duckduckgo.com", history: false });
    assert.deepEqual(restoreSettings({ engine: "__proto__", home: "nada" }), { engine: "google", home: DEFAULT_HOME, history: true });
  });
});

describe("historial", () => {
  const { addHistory, filterHistory, clearHistorySince, restoreHistory, MAX_HISTORY } = require("../public/browserurl.js");

  it("añade arriba, deduplica por URL y conserva el título si llega vacío", () => {
    let h = addHistory([], "https://a.com/", "A", 1);
    h = addHistory(h, "https://b.com/", "B", 2);
    h = addHistory(h, "https://a.com/", "", 3);
    assert.deepEqual(h, [{ url: "https://a.com/", title: "A", at: 3 }, { url: "https://b.com/", title: "B", at: 2 }]);
  });

  it("ignora lo que no es http(s) y respeta el tope", () => {
    assert.deepEqual(addHistory([], "about:blank", "", 1), []);
    assert.deepEqual(addHistory([], "file:///etc/passwd", "", 1), []);
    let h = [];
    for (let i = 0; i < MAX_HISTORY + 5; i++) h = addHistory(h, `https://x.com/${i}`, "", i);
    assert.equal(h.length, MAX_HISTORY);
    assert.equal(h[0].url, `https://x.com/${MAX_HISTORY + 4}`);
  });

  it("filtra por URL o título sin distinguir mayúsculas", () => {
    const h = [{ url: "https://github.com/", title: "GitHub", at: 1 }, { url: "https://tec.mx/", title: "Tec", at: 2 }];
    assert.equal(filterHistory(h, "GIT").length, 1);
    assert.equal(filterHistory(h, "tec")[0].url, "https://tec.mx/");
    assert.equal(filterHistory(h, "  ").length, 2);
  });

  it("borra desde una fecha o todo", () => {
    const h = [{ url: "https://b.com/", title: "", at: 20 }, { url: "https://a.com/", title: "", at: 10 }];
    assert.deepEqual(clearHistorySince(h, 15).map((x) => x.url), ["https://a.com/"]);
    assert.deepEqual(clearHistorySince(h, 0), []);
  });

  it("restoreHistory tira entradas corruptas", () => {
    assert.deepEqual(restoreHistory(null), []);
    assert.deepEqual(
      restoreHistory([{ url: "https://a.com/", title: 5, at: 1 }, { url: "javascript:x", at: 2 }, { url: "https://b.com/" }, null]),
      [{ url: "https://a.com/", title: "", at: 1 }],
    );
  });
});
