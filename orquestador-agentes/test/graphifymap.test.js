const test = require("node:test");
const assert = require("node:assert/strict");
const { toMapGraph, lineOf } = require("../graphifymap");

const ROOT = "/repo";

const sample = () => ({
  nodes: [
    { id: "git", label: "git.js", file_type: "code", source_file: "git.js", source_location: "L1", community: 0 },
    { id: "git_stage", label: "stage()", _callable: true, file_type: "code", source_file: "git.js", source_location: "L520", community: 0 },
    { id: "git_relpath", label: "relPathError()", _callable: true, file_type: "code", source_file: "git.js", source_location: "L40", community: 0 },
    { id: "git_fs", label: "fs", file_type: "code", source_file: "git.js", source_location: "L12" },
    { id: "srv", label: "server.js", file_type: "code", source_file: "/repo/lib/server.js", source_location: "L1", community: 1 },
    { id: "srv_run", label: ".cancel()", _callable: true, file_type: "code", source_file: "/repo/lib/server.js", source_location: "L9", community: 1 },
    { id: "ref_fs", label: "fs", file_type: "concept", source_file: "package.json" },
  ],
  links: [
    { source: "git_stage", target: "git_relpath", relation: "calls", source_file: "git.js", source_location: "L527" },
    { source: "git_stage", target: "git_relpath", relation: "calls", source_file: "git.js", source_location: "L530" },
    { source: "srv_run", target: "git_stage", relation: "indirect_call", confidence: "INFERRED", source_file: "lib/server.js", source_location: "L10" },
    { source: "srv", target: "git_stage", relation: "imports", source_file: "lib/server.js", source_location: "L2" },
    { source: "git", target: "ref_fs", relation: "imports_from" },
    { source: "git", target: "git_stage", relation: "contains" },
    { source: "git_stage", target: "git_fs", relation: "calls" },
  ],
});

const byId = (g, id) => g.nodes.find((n) => n.id === id);

test("lineOf lee la línea de source_location", () => {
  assert.equal(lineOf("L42"), 42);
  assert.equal(lineOf("x"), null);
  assert.equal(lineOf(undefined), null);
});

test("clasifica archivos, funciones y métodos", () => {
  const g = toMapGraph(sample(), ROOT);
  assert.equal(byId(g, "git").type, "file");
  assert.equal(byId(g, "git").lang, "js");
  assert.deepEqual(
    { type: byId(g, "git_stage").type, label: byId(g, "git_stage").label, kind: byId(g, "git_stage").kind, line: byId(g, "git_stage").line },
    { type: "fn", label: "stage", kind: "function", line: 520 }
  );
  assert.equal(byId(g, "srv_run").kind, "method");
  assert.equal(byId(g, "srv_run").label, "cancel");
});

test("descarta paquetes externos y constantes", () => {
  const g = toMapGraph(sample(), ROOT);
  assert.equal(byId(g, "ref_fs"), undefined);
  assert.equal(byId(g, "git_fs"), undefined);
});

test("rutas absolutas se vuelven relativas a root", () => {
  const g = toMapGraph(sample(), ROOT);
  assert.equal(byId(g, "srv").file, "lib/server.js");
  assert.equal(byId(g, "srv").dir, "lib");
  assert.equal(byId(g, "git").dir, "");
});

test("nodos fuera de root se descartan", () => {
  const gj = { nodes: [{ id: "x", label: "x.js", source_file: "/otro/x.js", source_location: "L1" }], links: [] };
  assert.equal(toMapGraph(gj, ROOT).nodes.length, 0);
});

test("cuenta las definiciones de cada archivo", () => {
  const g = toMapGraph(sample(), ROOT);
  assert.equal(byId(g, "git").defs, 2);
  assert.equal(byId(g, "srv").defs, 1);
});

test("calls se fusionan en una arista con count y sitios", () => {
  const g = toMapGraph(sample(), ROOT);
  const e = g.edges.filter((x) => x.source === "git_stage" && x.target === "git_relpath");
  assert.equal(e.length, 1);
  assert.equal(e[0].kind, "call");
  assert.equal(e[0].count, 2);
  assert.equal(e[0].ambiguous, false);
  assert.deepEqual(e[0].sites.map((s) => s.line), [527, 530]);
});

test("indirect_call es una llamada ambigua", () => {
  const g = toMapGraph(sample(), ROOT);
  const e = g.edges.find((x) => x.source === "srv_run");
  assert.equal(e.kind, "call");
  assert.equal(e.ambiguous, true);
});

test("un import a una función se sube a arista entre archivos", () => {
  const g = toMapGraph(sample(), ROOT);
  const imports = g.edges.filter((x) => x.kind === "import");
  assert.deepEqual(imports.map((x) => [x.source, x.target]), [["srv", "git"]]);
});

test("contains y aristas a nodos descartados no se pintan", () => {
  const g = toMapGraph(sample(), ROOT);
  assert.ok(!g.edges.some((x) => x.target === "git_fs" || x.target === "ref_fs"));
  assert.ok(!g.edges.some((x) => x.source === "git" && x.target === "git_stage"));
});

test("stats y engine", () => {
  const g = toMapGraph(sample(), ROOT);
  assert.equal(g.engine, "graphify");
  assert.equal(g.stats.files, 2);
  assert.equal(g.stats.functions, 3);
  assert.equal(g.stats.calls, 2);
  assert.equal(g.stats.imports, 1);
  assert.equal(g.stats.communities, 2);
});

test("entrada vacía o null no revienta", () => {
  for (const gj of [null, {}, { nodes: null, links: null }]) {
    const g = toMapGraph(gj, ROOT);
    assert.deepEqual([g.nodes.length, g.edges.length], [0, 0]);
  }
});
