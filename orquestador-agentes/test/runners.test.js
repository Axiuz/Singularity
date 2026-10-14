const test = require("node:test");
const assert = require("node:assert/strict");
const { langFor, outPath, planFor, requestError } = require("../runners");

const BINS = { clang: "/usr/bin/clang", python3: "/usr/bin/python3", "lldb-dap": "/x/lldb-dap", node: "/n/node" };
const find = (n) => (n.startsWith("/") ? n : BINS[n] || null);
const outDir = "/tmp/o";

test("langFor reconoce la extensión sin importar mayúsculas", () => {
  assert.equal(langFor("a.c").id, "c");
  assert.equal(langFor("a.CPP").id, "cpp");
  assert.equal(langFor("a.py").id, "python");
  assert.equal(langFor("a.ts").id, "typescript");
  assert.equal(langFor("a.txt"), null);
  assert.equal(langFor("Makefile"), null);
});

test("outPath deja un nombre seguro dentro de outDir", () => {
  assert.equal(outPath("/a/mi archivo.c", outDir), "/tmp/o/mi_archivo");
});

test("C compila con -g, ejecuta el binario y depura con lldb-dap", () => {
  const plan = planFor("/p/hola.c", { find, outDir });
  assert.equal(plan.steps[0].kind, "build");
  assert.equal(plan.steps[0].cmd, "/usr/bin/clang");
  assert.ok(plan.steps[0].args.includes("-g"));
  assert.ok(plan.steps[0].args.includes("/tmp/o/hola"));
  assert.equal(plan.run.cmd, "/tmp/o/hola");
  assert.equal(plan.debug.adapter, "lldb");
  assert.equal(plan.debug.cmd, "/x/lldb-dap");
  assert.equal(plan.debug.launch.program, "/tmp/o/hola");
  assert.deepEqual(plan.missing, []);
});

test("Python sin debugpy dice qué falta y cómo instalarlo", () => {
  const without = planFor("/p/a.py", { find, outDir, hasModule: () => false });
  assert.deepEqual(without.debug.missing, ["debugpy"]);
  assert.match(without.debug.install, /pip install --user debugpy/);
  const withIt = planFor("/p/a.py", { find, outDir, hasModule: () => true });
  assert.deepEqual(withIt.debug.missing, []);
  assert.equal(withIt.debug.install, null);
  assert.equal(withIt.debug.launch.program, "/p/a.py");
});

test("JS se ejecuta sin compilar y sin depurador", () => {
  const plan = planFor("/p/a.js", { find, outDir });
  assert.deepEqual(plan.steps, []);
  assert.equal(plan.run.cmd, "/n/node");
  assert.equal(plan.debug, null);
});

test("un compilador ausente aparece en missing", () => {
  assert.ok(planFor("/p/a.swift", { find, outDir }).missing.includes("swiftc"));
  assert.equal(planFor("/p/a.txt", { find, outDir }), null);
});

test("requestError solo deja pasar las órdenes de la lista blanca", () => {
  assert.equal(requestError("next"), null);
  assert.ok(requestError("disconnect"));
  assert.ok(requestError("launch"));
  assert.ok(requestError(undefined));
});
