const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { nextSplit, clampRatio } = require("../public/split.js");

describe("nextSplit", () => {
  it("abre a la derecha una pestaña que no está en ningún lado", () => {
    const result = nextSplit({ left: "tab1", right: null, ratio: 0.5 }, "tab2", "right");
    assert.deepEqual(result, { left: "tab1", right: "tab2", ratio: 0.5 });
  });

  it("reemplaza la pestaña derecha con una nueva", () => {
    const result = nextSplit({ left: "tab1", right: "tab2", ratio: 0.5 }, "tab3", "right");
    assert.deepEqual(result, { left: "tab1", right: "tab3", ratio: 0.5 });
  });

  it("intercambia al pedir a la izquierda la pestaña de la derecha", () => {
    const result = nextSplit({ left: "tab2", right: "tab1", ratio: 0.5 }, "tab1", "left");
    assert.deepEqual(result, { left: "tab1", right: "tab2", ratio: 0.5 });
  });

  it("intercambia al pedir a la derecha la pestaña de la izquierda", () => {
    const result = nextSplit({ left: "tab1", right: "tab2", ratio: 0.5 }, "tab1", "right");
    assert.deepEqual(result, { left: "tab2", right: "tab1", ratio: 0.5 });
  });

  it("clic normal sin división cambia la pestaña izquierda", () => {
    const result = nextSplit({ left: "tab1", right: null, ratio: 0.5 }, "tab2", "left");
    assert.deepEqual(result, { left: "tab2", right: null, ratio: 0.5 });
  });

  it("clic normal con división cambia solo la izquierda", () => {
    const result = nextSplit({ left: "tab1", right: "tab2", ratio: 0.3 }, "tab3", "left");
    assert.deepEqual(result, { left: "tab3", right: "tab2", ratio: 0.3 });
  });

  it("la misma pestaña en su mismo lado no cambia nada", () => {
    assert.deepEqual(nextSplit({ left: "tab1", right: null, ratio: 0.5 }, "tab1", "left"), { left: "tab1", right: null, ratio: 0.5 });
    assert.deepEqual(nextSplit({ left: "tab1", right: "tab2", ratio: 0.5 }, "tab2", "right"), { left: "tab1", right: "tab2", ratio: 0.5 });
  });

  it("cerrar la división quita el lado derecho", () => {
    const result = nextSplit({ left: "tab1", right: "tab2", ratio: 0.5 }, "tab2", "close");
    assert.deepEqual(result, { left: "tab1", right: null, ratio: 0.5 });
  });

  it("abrir a la derecha la pestaña izquierda sin división no hace nada", () => {
    const result = nextSplit({ left: "tab1", right: null, ratio: 0.5 }, "tab1", "right");
    assert.deepEqual(result, { left: "tab1", right: null, ratio: 0.5 });
  });

  it("no muta el estado de entrada", () => {
    const state = { left: "tab1", right: "tab2", ratio: 0.5 };
    nextSplit(state, "tab1", "right");
    assert.deepEqual(state, { left: "tab1", right: "tab2", ratio: 0.5 });
  });
});

describe("clampRatio", () => {
  it("limita el ratio a [0.2, 0.8]", () => {
    assert.equal(clampRatio(0.05), 0.2);
    assert.equal(clampRatio(0.95), 0.8);
    assert.equal(clampRatio(-1), 0.2);
    assert.equal(clampRatio(0.5), 0.5);
  });

  it("devuelve 0.5 si el ratio no es un número finito", () => {
    for (const v of ["abc", "0.3", undefined, null, NaN, Infinity]) assert.equal(clampRatio(v), 0.5);
  });
});
