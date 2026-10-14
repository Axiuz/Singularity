// Traduce reglas de EasyPrivacy a formato de WebKit para bloqueo de contenido.
// Solo acepta reglas de dominio ||host^ por su fiabilidad; otras sintaxis no tienen traducción fiable.

const MAX_RULES = 50000;
const TYPES = { script: "script", image: "image", ping: "ping", xmlhttprequest: "raw" };

// Analiza una línea de EasyPrivacy y la convierte en una regla de bloqueo de WebKit.
// Ante una opción desconocida descarta la regla entera en vez de bloquear de más. El url-filter no usa | porque el regex de WebKit no admite disyunciones.
function ruleFor(line) {
  const m = /^\|\|([a-z0-9.-]+)\^(?:\$(.+))?$/i.exec(line.trim());
  if (!m || m[1].startsWith(".") || !m[1].includes(".")) return null;
  const trigger = { "url-filter": `^[^:]+://+([^:/]+\\.)?${m[1].toLowerCase().replace(/\./g, "\\.")}[:/]` };
  const types = [];
  for (const opt of m[2] ? m[2].split(",") : []) {
    if (opt === "third-party") trigger["load-type"] = ["third-party"];
    else if (TYPES[opt]) types.push(TYPES[opt]);
    else return null;
  }
  if (types.length) trigger["resource-type"] = types;
  return { trigger, action: { type: "block" } };
}

// Convierte un texto con reglas de EasyPrivacy en un array de reglas compatibles con WebKit.
// Limita el número de reglas a MAX_RULES para evitar exceder el límite de WebKit.
function toRules(text) {
  const rules = [];
  for (const line of String(text ?? "").split("\n")) {
    const rule = ruleFor(line);
    if (rule) rules.push(rule);
    if (rules.length >= MAX_RULES) break;
  }
  return rules;
}

// Extrae la versión de la lista de EasyPrivacy; la app nativa solo recompila cuando cambia.
function listVersion(text) {
  return /^! Version: *(\S+)/m.exec(String(text ?? ""))?.[1] || null;
}

module.exports = { toRules, ruleFor, listVersion, MAX_RULES };
