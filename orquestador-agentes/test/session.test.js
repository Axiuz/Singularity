const test = require("node:test");
const assert = require("node:assert/strict");
const { cliOf, modeOf, sessionCommand, planStep, cardsSection } = require("../session");

test("cliOf con valor válido devuelve el CLI correspondiente", () => {
  assert.equal(cliOf({ session_cli: "antigravity" }), "antigravity");
  assert.equal(cliOf({ session_cli: "gemini" }), "antigravity");
});

test("cliOf con valor desconocido devuelve 'claude'", () => {
  assert.equal(cliOf({ session_cli: "unknown" }), "claude");
});

test("cliOf con config undefined devuelve 'claude'", () => {
  assert.equal(cliOf(undefined), "claude");
});

test("cliOf con config sin session_cli devuelve 'claude'", () => {
  assert.equal(cliOf({}), "claude");
});

test("modeOf con valor válido devuelve el modo correspondiente", () => {
  assert.equal(modeOf({ orchestration_mode: "solo" }), "solo");
});

test("modeOf con valor desconocido devuelve 'local'", () => {
  assert.equal(modeOf({ orchestration_mode: "unknown" }), "local");
});

test("modeOf con config undefined devuelve 'local'", () => {
  assert.equal(modeOf(undefined), "local");
});

test("modeOf con config sin orchestration_mode devuelve 'local'", () => {
  assert.equal(modeOf({}), "local");
});

test("sessionCommand con cli 'antigravity' usa agy -i", () => {
  assert.match(sessionCommand("antigravity"), /^agy -i "\$DISPATCH_INSTRUCTIONS"$/);
});

test("sessionCommand con cli 'codex' pasa instrucciones como argumento", () => {
  assert.match(sessionCommand("codex"), /codex "\$DISPATCH_INSTRUCTIONS"/);
});

test("sessionCommand con cli 'claude' y remote true incluye caffeinate y --remote-control", () => {
  assert.match(sessionCommand("claude", { remote: true }), /\/usr\/bin\/caffeinate -ims/);
  assert.match(sessionCommand("claude", { remote: true }), /--remote-control "\$DISPATCH_RC_NAME"/);
});

test("sessionCommand con cli 'claude' y remote false no incluye caffeinate ni --remote-control", () => {
  assert.doesNotMatch(sessionCommand("claude", { remote: false }), /\/usr\/bin\/caffeinate/);
  assert.doesNotMatch(sessionCommand("claude", { remote: false }), /--remote-control/);
});

test("planStep con cli 'claude' menciona 'plan mode'", () => {
  assert.match(planStep("claude"), /plan mode/);
});

test("planStep con cli 'antigravity' no menciona 'plan mode'", () => {
  assert.doesNotMatch(planStep("antigravity"), /plan mode/);
});

test("cardsSection con cli 'claude' menciona que las tarjetas 'te llegan solas'", () => {
  assert.match(cardsSection("claude", 3000, "my-project"), /Te llegan\s+solas/);
});

test("cardsSection con cli 'codex' incluye consulta a /api/plan y ruta en notas", () => {
  assert.match(cardsSection("codex", 3000, "my-project"), /curl -s http:\/\/localhost:3000\/api\/plan/);
  assert.match(cardsSection("codex", 3000, "my-project"), /path=my-project/);
});

test("cardsSection con cli 'codex' y sin proyecto usa <ruta del repo>", () => {
  assert.match(cardsSection("codex", 3000), /path=<ruta del repo>/);
});