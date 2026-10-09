// ============================================================================
// graphifymap.js — traduce el grafo de graphify al formato del Mapa (sin estado).
//
// Recibe el graph.json que deja `graphify update` y devuelve lo mismo que
// codegraph.buildGraph(), para que public/graph.js lo pinte sin saber qué motor
// lo hizo.
// ============================================================================

const path = require("path");
const { langForFile } = require("./codegraph");

const CALL_RELATIONS = { calls: false, indirect_call: true };
const IMPORT_RELATIONS = new Set(["imports", "imports_from"]);

const lineOf = (loc) => {
  const m = /^L(\d+)/.exec(String(loc || ""));
  return m ? Number(m[1]) : null;
};

// Transforma una ruta absoluta o relativa en una ruta relativa desde root,
// normalizando los separadores a /.
function relFile(file, root) {
  const raw = String(file || "");
  const rel = path.isAbsolute(raw) ? path.relative(root, raw) : raw;
  return rel.split(path.sep).join("/");
}

const dirOf = (rel) => (path.posix.dirname(rel) === "." ? "" : path.posix.dirname(rel));

// Convierte el grafo de graphify (en formato JSON) en el formato del mapa
// que usa public/graph.js para visualización. Ajusta los nodos y aristas
// para que coincidan con el modelo interno del sistema: marca archivos
// como tales cuando su label coincide con el nombre del archivo y no es invocable,
// y transforma llamadas e importaciones en aristas inferidas o directas.
// También agrega información de lenguaje, comunidad y líneas de código.
function toMapGraph(gj, root, started = Date.now()) {
  const raw = Array.isArray(gj && gj.nodes) ? gj.nodes : [];
  const links = Array.isArray(gj && (gj.links || gj.edges)) ? gj.links || gj.edges : [];

  const nodes = [];
  const byId = new Map();
  const fileIds = new Map();

  for (const n of raw) {
    // concept son paquetes externos (express, fs); las constantes e imports sueltos
    // caen por no ser invocables. Se tiran para no llenar el mapa de ruido.
    if (!n || n.file_type === "concept" || !n.source_file) continue;
    const file = relFile(n.source_file, root);
    if (!file || file.startsWith("..")) continue;
    const label = String(n.label || n.id);
    const community = Number.isInteger(n.community) ? n.community : undefined;
    const lang = langForFile(file);
    if (label === path.posix.basename(file) && !n._callable) {
      const node = { id: n.id, type: "file", label, file, dir: dirOf(file), lang: lang ? lang.id : "otro", defs: 0, community };
      nodes.push(node);
      byId.set(n.id, node);
      fileIds.set(file, n.id);
    } else if (n._callable) {
      const name = label.replace(/\(\)$/, "").replace(/^\./, "");
      const node = {
        id: n.id,
        type: "fn",
        label: name,
        file,
        dir: dirOf(file),
        lang: lang ? lang.id : "otro",
        kind: label.startsWith(".") ? "method" : "function",
        line: lineOf(n.source_location),
        community,
      };
      nodes.push(node);
      byId.set(n.id, node);
    }
  }

  for (const node of nodes) {
    if (node.type === "fn" && fileIds.has(node.file)) byId.get(fileIds.get(node.file)).defs++;
  }

  const merged = new Map();
  const addEdge = (source, target, kind, ambiguous, site) => {
    if (source === target) return;
    const key = `${source}|${target}|${kind}`;
    let edge = merged.get(key);
    if (!edge) {
      edge = { source, target, kind, count: 0, sites: [], ambiguous };
      merged.set(key, edge);
    }
    edge.count++;
    if (!ambiguous) edge.ambiguous = false;
    if (site && edge.sites.length < 12) edge.sites.push(site);
  };

  for (const e of links) {
    const a = byId.get(e.source);
    const b = byId.get(e.target);
    if (!a || !b) continue;
    const line = lineOf(e.source_location);
    const site = e.source_file ? { file: relFile(e.source_file, root), line } : null;
    // indirect_call es INFERRED (función pasada como argumento): punteada, como las
    // llamadas dudosas del motor interno. Un import puede apuntar a una función de
    // otro archivo, y el mapa dibuja los imports entre archivos: se sube a cada uno.
    if (e.relation in CALL_RELATIONS) {
      addEdge(a.id, b.id, "call", CALL_RELATIONS[e.relation] || e.confidence === "INFERRED", site);
    } else if (IMPORT_RELATIONS.has(e.relation)) {
      const from = fileIds.get(a.file);
      const to = fileIds.get(b.file);
      if (from && to) addEdge(from, to, "import", false, site);
    }
  }

  const edges = [...merged.values()];
  const files = nodes.filter((n) => n.type === "file");
  return {
    root,
    engine: "graphify",
    builtAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    stats: {
      files: files.length,
      analyzed: files.length,
      functions: nodes.length - files.length,
      calls: edges.filter((e) => e.kind === "call").length,
      imports: edges.filter((e) => e.kind === "import").length,
      truncated: false,
      languages: [...new Set(files.map((f) => f.lang))],
      communities: new Set(nodes.map((n) => n.community).filter((c) => c !== undefined)).size,
    },
    nodes,
    edges,
  };
}

module.exports = { toMapGraph, lineOf };
