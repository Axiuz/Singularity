const test = require("node:test");
const assert = require("node:assert/strict");
const { compareVersions, pickRelease, updateInfo, createChecker } = require("../update");

const rel = (tag, asset, extra = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  html_url: `https://gh/${tag}`,
  assets: asset ? [{ name: asset, browser_download_url: `https://dl/${asset}` }] : [],
  ...extra,
});

test("compareVersions compara por números, no por texto", () => {
  assert.equal(compareVersions("2.1.10", "2.1.9"), 1);
  assert.equal(compareVersions("2.1.9", "2.1.10"), -1);
  assert.equal(compareVersions("2.1.4", "2.1.4"), 0);
  assert.equal(compareVersions("3.0.0", "2.9.9"), 1);
  assert.equal(compareVersions("2.1", "2.1.0"), 0);
  assert.equal(compareVersions("2.1", "2.1.1"), -1);
});

test("pickRelease elige la versión más alta de cada edición", () => {
  const list = [
    rel("v2.1.9", "Singularity-2.1.9.dmg"),
    rel("v2.1.10", "Singularity-2.1.10.dmg"),
    rel("ai-v2.1.11", "Singularity-AI-Subscription-2.1.11.dmg"),
    rel("ai-v2.1.3", "Singularity-AI-Subscription-2.1.3.dmg"),
  ];
  assert.deepEqual(pickRelease(list, "local"), { version: "2.1.10", url: "https://dl/Singularity-2.1.10.dmg", page: "https://gh/v2.1.10" });
  assert.equal(pickRelease(list, "cloud").version, "2.1.11");
});

test("pickRelease ignora draft, prerelease y releases sin el DMG exacto", () => {
  const list = [
    rel("v2.1.1", "Singularity-2.1.1.dmg"),
    rel("v2.1.5", "Singularity-2.1.5.dmg", { draft: true }),
    rel("v2.1.6", "Singularity-2.1.6.dmg", { prerelease: true }),
    rel("v2.1.7", "Singularity-2.1.7.zip"),
    rel("v2.1.8", null),
    rel("v2.1.9", "Singularity-AI-Subscription-2.1.9.dmg"),
  ];
  assert.equal(pickRelease(list, "local").version, "2.1.1");
});

test("pickRelease no mezcla ediciones ni acepta tags raros", () => {
  const list = [rel("ai-v2.1.9", "Singularity-2.1.9.dmg"), rel("v2.1.9", "Singularity-AI-Subscription-2.1.9.dmg"), rel("v2.1.9-beta", "Singularity-2.1.9-beta.dmg")];
  assert.equal(pickRelease(list, "local"), null);
  assert.equal(pickRelease(list, "cloud"), null);
});

test("pickRelease devuelve null con edición desconocida o datos que no son lista", () => {
  assert.equal(pickRelease([rel("v2.1.1", "Singularity-2.1.1.dmg")], "otra"), null);
  assert.equal(pickRelease({ message: "API rate limit exceeded" }, "local"), null);
  assert.equal(pickRelease(null, "local"), null);
});

test("updateInfo solo marca available si hay una versión mayor", () => {
  const list = [rel("v2.1.5", "Singularity-2.1.5.dmg")];
  assert.equal(updateInfo(list, { edition: "local", current: "2.1.4" }).available, true);
  assert.equal(updateInfo(list, { edition: "local", current: "2.1.5" }).available, false);
  assert.equal(updateInfo(list, { edition: "local", current: "2.1.6" }).available, false);
  const none = updateInfo([], { edition: "local", current: "2.1.4" });
  assert.deepEqual(none, { edition: "local", current: "2.1.4", latest: null, available: false, url: null, page: null });
});

const fakeFetch = (releases, ok = true) => {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    return { ok, status: ok ? 200 : 403, json: async () => releases };
  };
  fn.calls = calls;
  return fn;
};

test("createChecker consulta GitHub y devuelve la info", async () => {
  const fetchImpl = fakeFetch([rel("v2.1.5", "Singularity-2.1.5.dmg")]);
  const info = await createChecker({ edition: "local", current: "2.1.4", fetchImpl })();
  assert.equal(info.available, true);
  assert.equal(info.url, "https://dl/Singularity-2.1.5.dmg");
  assert.match(fetchImpl.calls[0], /api\.github\.com\/repos\/Axiuz\/Singularity\/releases/);
});

test("createChecker no consulta nada fuera de la app instalada", async () => {
  const fetchImpl = fakeFetch([]);
  assert.equal((await createChecker({ edition: undefined, current: "2.1.4", fetchImpl })()).available, false);
  assert.equal((await createChecker({ edition: "local", current: "", fetchImpl })()).available, false);
  assert.equal(fetchImpl.calls.length, 0);
});

test("createChecker guarda en caché 10 minutos", async () => {
  let t = 0;
  const fetchImpl = fakeFetch([]);
  const check = createChecker({ edition: "cloud", current: "2.1.4", fetchImpl, now: () => t });
  await check();
  t += 9 * 60 * 1000;
  await check();
  assert.equal(fetchImpl.calls.length, 1);
  t += 2 * 60 * 1000;
  await check();
  assert.equal(fetchImpl.calls.length, 2);
});

test("createChecker rechaza si GitHub no responde bien y no guarda el fallo", async () => {
  const fetchImpl = fakeFetch([], false);
  const check = createChecker({ edition: "local", current: "2.1.4", fetchImpl });
  await assert.rejects(check(), /GitHub respondió 403/);
  await assert.rejects(check());
  assert.equal(fetchImpl.calls.length, 2);
});
