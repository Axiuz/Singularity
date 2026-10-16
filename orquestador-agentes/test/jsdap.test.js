const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const { urlRegexFor, fileFromUrl, describe, hasChildren, stopReason, isNoise } = require("../jsdap");

test("urlRegexFor casa con la URL file:// y con la ruta plana", () => {
  const file = "/a/b c.js";
  const re = new RegExp(urlRegexFor(file));
  assert.match(pathToFileURL(file).href, re);
  assert.match(file, re);
});

test("urlRegexFor no casa con otra ruta que la contiene", () => {
  const re = new RegExp(urlRegexFor("/a/b.js"));
  assert.doesNotMatch("/a/b.js.map", re);
  assert.doesNotMatch("/x/a/b.js", re);
  assert.doesNotMatch("/a/bxjs", re);
});

test("fileFromUrl convierte file:// y deja pasar rutas absolutas", () => {
  assert.equal(fileFromUrl("file:///a/b%20c.js"), "/a/b c.js");
  assert.equal(fileFromUrl("/a/b.js"), "/a/b.js");
});

test("fileFromUrl devuelve null para internos, relativas y vacíos", () => {
  assert.equal(fileFromUrl("node:internal/main"), null);
  assert.equal(fileFromUrl("rel/a.js"), null);
  assert.equal(fileFromUrl(""), null);
  assert.equal(fileFromUrl(null), null);
});

test("describe da el valor como lo escribiría JS", () => {
  assert.equal(describe({ type: "string", value: 'di "hola"' }), '"di \\"hola\\""');
  assert.equal(describe({ type: "number", value: 42 }), "42");
  assert.equal(describe({ type: "boolean", value: false }), "false");
  assert.equal(describe({ type: "undefined" }), "undefined");
  assert.equal(describe(undefined), "undefined");
  assert.equal(describe({ type: "object", subtype: "null", value: null }), "null");
  assert.equal(describe({ type: "object", description: "Array(3)" }), "Array(3)");
  assert.equal(describe({ type: "object" }), "Object");
  assert.equal(describe({ type: "number", unserializableValue: "NaN" }), "NaN");
  assert.equal(describe({ type: "function", description: "function f() {}" }), "function f() {}");
  assert.equal(describe({ type: "bigint", unserializableValue: "10n", description: "10n" }), "10n");
  assert.equal(describe({ type: "symbol", description: "Symbol(x)" }), "Symbol(x)");
});

test("hasChildren solo con objetos o funciones con objectId", () => {
  assert.equal(hasChildren({ type: "object", objectId: "1" }), true);
  assert.equal(hasChildren({ type: "function", objectId: "1" }), true);
  assert.equal(hasChildren({ type: "object", subtype: "null", objectId: "1" }), false);
  assert.equal(hasChildren({ type: "object" }), false);
  assert.equal(hasChildren({ type: "string", value: "x" }), false);
  assert.equal(hasChildren(null), false);
});

test("stopReason prioriza breakpoint y excepción sobre la última acción", () => {
  assert.equal(stopReason({ hitBreakpoints: ["1:2:0"] }, "step"), "breakpoint");
  assert.equal(stopReason({ reason: "exception", hitBreakpoints: [] }, "step"), "exception");
  assert.equal(stopReason({ reason: "promiseRejection" }, null), "exception");
});

test("stopReason usa la última acción y cae a breakpoint", () => {
  assert.equal(stopReason({ reason: "other" }, "pause"), "pause");
  assert.equal(stopReason({ reason: "other" }, "step"), "step");
  assert.equal(stopReason({ reason: "debugCommand" }, null), "pause");
  assert.equal(stopReason({ reason: "other" }, null), "breakpoint");
});

test("isNoise reconoce los avisos del inspector", () => {
  assert.equal(isNoise("Debugger listening on ws://127.0.0.1:9229/abc"), true);
  assert.equal(isNoise("  For help, see: https://nodejs.org/en/docs/inspector"), true);
  assert.equal(isNoise("Debugger attached."), true);
  assert.equal(isNoise("Waiting for the debugger to disconnect..."), true);
  assert.equal(isNoise("Error: Debugger attached. en mi programa"), false);
  assert.equal(isNoise("hola"), false);
});
