const test = require("node:test");
const assert = require("node:assert/strict");
const { PRESETS, isHex, withAlpha, mix, cleanOverrides, cleanFont, cleanState, resolve } = require("../public/theme");

test("isHex acepta hex válido y rechaza otros", () => {
  assert.ok(isHex("#a1B2c3"));
  assert.ok(!isHex("#abc"));
  assert.ok(!isHex("a1b2c3"));
  assert.ok(!isHex("#a1b2c3ff"));
  assert.ok(!isHex(123));
  assert.ok(!isHex(null));
});

test("withAlpha con alpha válido y fuera de rango", () => {
  assert.strictEqual(withAlpha("#ff0000", 0.5), "#ff000080");
  assert.strictEqual(withAlpha("#ff0000", 2), "#ff0000ff");
  assert.strictEqual(withAlpha("#ff0000", -1), "#ff000000");
});

test("mix mezcla colores correctamente", () => {
  assert.strictEqual(mix("#000000", "#ffffff", 0.5), "#808080");
  assert.strictEqual(mix("#000000", "#ffffff", 0), "#000000");
  assert.strictEqual(mix("#000000", "#ffffff", 1), "#ffffff");
});

test("todos los PRESETS tienen claves iguales y valores hex", () => {
  const keys = Object.keys(PRESETS.singularity.colors);
  Object.keys(PRESETS).forEach(id => {
    assert.deepStrictEqual(Object.keys(PRESETS[id].colors), keys);
    keys.forEach(k => assert.ok(isHex(PRESETS[id].colors[k])));
  });
});

test("cleanOverrides descarta claves no en EDITABLE y valores no hex, pasa a minúsculas", () => {
  assert.deepStrictEqual(cleanOverrides({ accent: "#FF0000", bg: "#111111", code: "#00ff00" }), { accent: "#ff0000", code: "#00ff00" });
  assert.deepStrictEqual(cleanOverrides({ accent: "nothex", code: "#00ff00" }), { code: "#00ff00" });
  assert.deepStrictEqual(cleanOverrides(null), {});
  assert.deepStrictEqual(cleanOverrides({}), {});
});

test("cleanFont maneja familia, tamaño, lineHeight y ligatures", () => {
  assert.deepStrictEqual(cleanFont({ family: "unknown", size: 50, lineHeight: 9, ligatures: "true" }), { family: "sf", size: 24, lineHeight: 2.2, ligatures: false });
  assert.deepStrictEqual(cleanFont({ family: "sf", size: 2, lineHeight: 1.5, ligatures: true }), { family: "sf", size: 10, lineHeight: 1.5, ligatures: true });
  assert.deepStrictEqual(cleanFont({ family: "fira", size: "abc", lineHeight: 0.5, ligatures: false }), { family: "fira", size: 13, lineHeight: 1.2, ligatures: false });
  assert.deepStrictEqual(cleanFont(undefined), { family: "sf", size: 13, lineHeight: 1.55, ligatures: false });
});

test("cleanState maneja preset desconocido y null", () => {
  assert.deepStrictEqual(cleanState({ preset: "unknown", overrides: { accent: "#ff0000" } }), { preset: "singularity", overrides: { accent: "#ff0000" }, font: { family: "sf", size: 13, lineHeight: 1.55, ligatures: false } });
  assert.equal(cleanState({ preset: "nord" }).preset, "nord");
  assert.deepStrictEqual(cleanState(null), { preset: "singularity", overrides: {}, font: { family: "sf", size: 13, lineHeight: 1.55, ligatures: false } });
});

test("resolve aplica overrides y deriva colores correctamente", () => {
  const state = { preset: "singularity", overrides: { "syn-keyword": "#00ff00", accent: "#ff00ff" } };
  const result = resolve(state);
  assert.strictEqual(result["syn-keyword"], "#00ff00");
  assert.strictEqual(result["syn-bracket-2"], "#00ff00");
  assert.strictEqual(result["accent-soft"], withAlpha("#ff00ff", 0.16));
  assert.strictEqual(result.bg, PRESETS.singularity.colors.bg);
});

