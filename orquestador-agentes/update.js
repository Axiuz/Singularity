// Busca el release más reciente en GitHub de Axiuz/Singularity para la edición actual
// (v2.1.N o local-v2.1.N), compara su versión con la instalada y devuelve si hay una
// versión más reciente. Se usa en la ruta GET /api/update para permitir a la app nativa
// ofrecer una actualización.

const REPO = "Axiuz/Singularity";
const CACHE_MS = 10 * 60 * 1000;

const EDITIONS = {
  cloud: { tag: /^v(\d+\.\d+\.\d+)$/, asset: (v) => `Singularity-${v}.dmg` },
  local: { tag: /^local-v(\d+\.\d+\.\d+)$/, asset: (v) => `Singularity-Local-${v}.dmg` },
};

// Compara dos versiones en formato x.y.z, devolviendo -1, 0 o 1 según si a <, = o > b.
// Usa un límite de 3 componentes para evitar errores con versiones no estándar.
function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

// Elige el release más nuevo de una edición por tag y por nombre exacto del DMG, sin
// draft ni prerelease. No usa /releases/latest: las dos ediciones comparten repo y
// GitHub solo marca uno de los dos como latest.
function pickRelease(releases, edition) {
  const spec = EDITIONS[edition];
  if (!spec || !Array.isArray(releases)) return null;
  let best = null;
  for (const r of releases) {
    if (!r || r.draft || r.prerelease) continue;
    const match = spec.tag.exec(r.tag_name || "");
    if (!match) continue;
    const version = match[1];
    const asset = (r.assets || []).find((a) => a.name === spec.asset(version));
    if (!asset) continue;
    if (!best || compareVersions(version, best.version) > 0) best = { version, url: asset.browser_download_url, page: r.html_url };
  }
  return best;
}

// Construye un objeto con información de actualización: versión actual, disponible,
// URL y página del lanzamiento más reciente. Indica si hay una actualización disponible.
// Usa pickRelease para obtener la versión más reciente válida.
function updateInfo(releases, { edition, current }) {
  const latest = pickRelease(releases, edition);
  return {
    edition,
    current,
    latest: latest ? latest.version : null,
    available: Boolean(latest && current && compareVersions(latest.version, current) > 0),
    url: latest ? latest.url : null,
    page: latest ? latest.page : null,
  };
}

// Devuelve un checkeo asíncrono de actualizaciones que consulta GitHub con caché de 10 minutos.
// Evita llamadas repetidas y fallas de API; no consulta si no hay edición o versión actual.
function createChecker({ edition, current, fetchImpl = fetch, now = Date.now }) {
  let cache = null;
  return async function check() {
    if (!EDITIONS[edition] || !current) return { edition: edition || null, current: current || null, available: false, reason: "Solo la app instalada se actualiza" };
    if (cache && now() - cache.at < CACHE_MS) return cache.info;
    const res = await fetchImpl(`https://api.github.com/repos/${REPO}/releases?per_page=30`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Singularity" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`GitHub respondió ${res.status}`);
    const info = updateInfo(await res.json(), { edition, current });
    cache = { at: now(), info };
    return info;
  };
}

module.exports = { REPO, EDITIONS, compareVersions, pickRelease, updateInfo, createChecker };
