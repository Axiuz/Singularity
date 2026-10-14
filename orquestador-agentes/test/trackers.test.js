const test = require("node:test");
const assert = require("node:assert/strict");
const { toRules, ruleFor, listVersion, MAX_RULES } = require("../trackers");

test("||host^ bloquea el dominio y sus subdominios, con los puntos escapados", () => {
  const rule = ruleFor("||ads.example.com^");
  assert.deepEqual(rule, {
    trigger: { "url-filter": "^[^:]+://+([^:/]+\\.)?ads\\.example\\.com[:/]" },
    action: { type: "block" },
  });
  const re = new RegExp(rule.trigger["url-filter"]);
  assert.ok(re.test("https://x.ads.example.com/a.js"));
  assert.ok(!re.test("https://adsXexample.com/"));
});

test("las opciones soportadas pasan a load-type y resource-type", () => {
  assert.deepEqual(ruleFor("||t.com^$third-party").trigger["load-type"], ["third-party"]);
  const t = ruleFor("||t.com^$script,xmlhttprequest,third-party").trigger;
  assert.deepEqual(t["resource-type"], ["script", "raw"]);
  assert.deepEqual(t["load-type"], ["third-party"]);
});

test("se descartan las reglas que no son de dominio o con opciones desconocidas", () => {
  for (const line of ["@@||t.com^", "##.ad", "/track/", "||t.com/path^", "||localhost^", "||.t.com^",
    "||t.com^$domain=x.com", "||t.com^$~script", "||t.com^$redirect=noopjs", "! comentario", ""]) {
    assert.equal(ruleFor(line), null, line);
  }
});

test("el host sale en minúsculas", () => {
  assert.match(ruleFor("||T.COM^").trigger["url-filter"], /t\\\.com/);
});

test("toRules ignora la basura y respeta el tope", () => {
  assert.equal(toRules("[Adblock Plus]\n||a.com^\nbasura\n||b.com^\r\n").length, 2);
  const many = Array.from({ length: MAX_RULES + 5 }, (_, i) => `||h${i}.com^`).join("\n");
  assert.equal(toRules(many).length, MAX_RULES);
  assert.deepEqual(toRules(null), []);
});

test("listVersion lee la cabecera", () => {
  assert.equal(listVersion("[Adblock Plus 1.1]\n! Version: 202610120448\n"), "202610120448");
  assert.equal(listVersion("||a.com^"), null);
});
