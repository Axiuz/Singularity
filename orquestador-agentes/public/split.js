// Decide qué pestaña va a cada lado de la pantalla dividida del centro del
// panel y limita el reparto entre los dos. Puro y sin estado, como
// branchcolor.js: el mismo archivo vale en el navegador y en node --test.
(function (root) {
  const MIN_RATIO = 0.2;
  const MAX_RATIO = 0.8;

  // Asegura que el ratio sea un número válido entre 0.2 y 0.8 para evitar
  // paneles inservibles o desbordantes por datos corruptos en localStorage.
  function clampRatio(ratio) {
    if (typeof ratio !== "number" || !Number.isFinite(ratio)) return 0.5;
    return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
  }

  // Reorganiza las pestañas entre izquierda y derecha, evitando duplicados;
  // si se cierra el lado, se elimina; si se mueve una pestaña, se intercambia
  // con el lado opuesto, pero no se permite tener la misma pestaña en ambos lados.
  function nextSplit(state, tab, side) {
    const s = { left: state.left, right: state.right || null, ratio: clampRatio(state.ratio) };
    if (side === "close") return { ...s, right: null };
    if (side === "right") {
      if (tab === s.right) return s;
      if (tab === s.left) {
        if (!s.right) return s;
        return { ...s, left: s.right, right: tab };
      }
      return { ...s, right: tab };
    }
    if (tab === s.left) return s;
    if (tab === s.right) return { ...s, left: tab, right: s.left };
    return { ...s, left: tab };
  }

  const api = { nextSplit, clampRatio, MIN_RATIO, MAX_RATIO };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Split = api;
})(typeof window !== "undefined" ? window : globalThis);
