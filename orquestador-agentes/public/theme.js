// Define las variables de :root para el color del tema de Singularity (Singularity,
// Medianoche, Nord, Dracula, Bosque, Monocromo), incluyendo colores de acento, texto y
// sintaxis, así como configuración de fuente para el editor y terminales. Guarda la
// elección en localStorage del Mac y dispara el evento theme:change. Se carga antes que
// veil.js para asegurar que el tema esté disponible en todas las partes de la app.

(function (root) {
  const KEY = "theme.v1";

  const SURFACES = ["bg", "rail", "sunken", "editor-bg", "panel", "panel-active", "panel-2", "panel-3"];

  const PRESETS = {
    singularity: {
      label: "Singularity",
      colors: {
        bg: "#0a0a0a", rail: "#111111", sunken: "#0d0d0d", "editor-bg": "#0d0d0d",
        panel: "#171717", "panel-active": "#1f1f1f", "panel-2": "#222222", "panel-3": "#2e2e2e",
        "border-soft": "#242424", border: "#333333", "border-strong": "#474747", "border-dashed": "#525252", ghost: "#6b6b6b",
        text: "#f4f1e8", "text-2": "#d8d4c8", code: "#dfdfd8", muted: "#a2a29a", faint: "#8a8a82",
        accent: "#f0c040", "on-accent": "#0d0d0d",
        teal: "#4a6fd4", "teal-deep": "#1c2a5c", green: "#3ad4c2", amber: "#f0a838", red: "#ff6f5e", violet: "#a89bff",
        "syn-comment": "#8c9a86", "syn-string": "#f0b86e", "syn-number": "#7fe0c4", "syn-keyword": "#c8a2ff",
        "syn-control": "#ff9d8a", "syn-type": "#6fd8ff", "syn-function": "#f5d06a", "syn-variable": "#e4e0d4",
        "syn-constant": "#ff9d8a", "syn-operator": "#b0aea6", "syn-tag": "#7fb8ff", "syn-attr": "#f5d06a", "syn-regexp": "#ffb3a0",
        "syn-line": "#151515", "syn-guide": "#262626", "syn-guide-active": "#4a4a4a",
      },
    },
    medianoche: {
      label: "Medianoche",
      colors: {
        bg: "#0b0f1a", rail: "#0f1422", sunken: "#0d1220", "editor-bg": "#0d1220",
        panel: "#141a2b", "panel-active": "#1a2236", "panel-2": "#1e2740", "panel-3": "#28334f",
        "border-soft": "#1e2638", border: "#2a3550", "border-strong": "#3d4a6b", "border-dashed": "#4a5880", ghost: "#5f6c8f",
        text: "#e8ecf7", "text-2": "#c9d1e6", code: "#d8deef", muted: "#9aa5c2", faint: "#7f8aa8",
        accent: "#6ea8ff", "on-accent": "#0b0f1a",
        teal: "#4a6fd4", "teal-deep": "#1c2a5c", green: "#4fd6be", amber: "#f2b35e", red: "#ff7a8a", violet: "#b49cff",
        "syn-comment": "#6b7a99", "syn-string": "#9ece6a", "syn-number": "#ff9e64", "syn-keyword": "#bb9af7",
        "syn-control": "#f7768e", "syn-type": "#2ac3de", "syn-function": "#7aa2f7", "syn-variable": "#c0caf5",
        "syn-constant": "#ff9e64", "syn-operator": "#89ddff", "syn-tag": "#f7768e", "syn-attr": "#e0af68", "syn-regexp": "#b4f9f8",
        "syn-line": "#121829", "syn-guide": "#1c2338", "syn-guide-active": "#3b4566",
      },
    },
    nord: {
      label: "Nord",
      colors: {
        bg: "#242933", rail: "#2a303c", sunken: "#272c36", "editor-bg": "#2e3440",
        panel: "#3b4252", "panel-active": "#434c5e", "panel-2": "#434c5e", "panel-3": "#4c566a",
        "border-soft": "#3b4252", border: "#434c5e", "border-strong": "#4c566a", "border-dashed": "#616e88", ghost: "#7b88a1",
        text: "#eceff4", "text-2": "#e5e9f0", code: "#d8dee9", muted: "#a3adbf", faint: "#8892a6",
        accent: "#88c0d0", "on-accent": "#2e3440",
        teal: "#5e81ac", "teal-deep": "#2e3c55", green: "#a3be8c", amber: "#ebcb8b", red: "#bf616a", violet: "#b48ead",
        "syn-comment": "#7b88a1", "syn-string": "#a3be8c", "syn-number": "#b48ead", "syn-keyword": "#81a1c1",
        "syn-control": "#81a1c1", "syn-type": "#8fbcbb", "syn-function": "#88c0d0", "syn-variable": "#d8dee9",
        "syn-constant": "#d08770", "syn-operator": "#81a1c1", "syn-tag": "#81a1c1", "syn-attr": "#8fbcbb", "syn-regexp": "#ebcb8b",
        "syn-line": "#353c4a", "syn-guide": "#3b4252", "syn-guide-active": "#4c566a",
      },
    },
    dracula: {
      label: "Dracula",
      colors: {
        bg: "#191a21", rail: "#1e1f29", sunken: "#21222c", "editor-bg": "#282a36",
        panel: "#2b2d3a", "panel-active": "#343746", "panel-2": "#343746", "panel-3": "#44475a",
        "border-soft": "#2f3142", border: "#3c3f52", "border-strong": "#44475a", "border-dashed": "#6272a4", ghost: "#6272a4",
        text: "#f8f8f2", "text-2": "#e6e6e0", code: "#f8f8f2", muted: "#b4b7c9", faint: "#9093a8",
        accent: "#bd93f9", "on-accent": "#191a21",
        teal: "#6272a4", "teal-deep": "#2d3250", green: "#50fa7b", amber: "#ffb86c", red: "#ff5555", violet: "#ff79c6",
        "syn-comment": "#7a86b6", "syn-string": "#f1fa8c", "syn-number": "#bd93f9", "syn-keyword": "#ff79c6",
        "syn-control": "#ff79c6", "syn-type": "#8be9fd", "syn-function": "#50fa7b", "syn-variable": "#f8f8f2",
        "syn-constant": "#bd93f9", "syn-operator": "#ff79c6", "syn-tag": "#ff79c6", "syn-attr": "#50fa7b", "syn-regexp": "#f1fa8c",
        "syn-line": "#2f3142", "syn-guide": "#343746", "syn-guide-active": "#565a72",
      },
    },
    bosque: {
      label: "Bosque",
      colors: {
        bg: "#0c100d", rail: "#111612", sunken: "#0e130f", "editor-bg": "#0e130f",
        panel: "#161d17", "panel-active": "#1c251d", "panel-2": "#202a21", "panel-3": "#2b382c",
        "border-soft": "#1f2920", border: "#2c3a2d", "border-strong": "#405442", "border-dashed": "#4e664f", ghost: "#667a68",
        text: "#eef2e6", "text-2": "#d3dbc6", code: "#dde4d2", muted: "#a3ad98", faint: "#87927d",
        accent: "#9ccf5f", "on-accent": "#0c100d",
        teal: "#4f8a6b", "teal-deep": "#1d3a2b", green: "#6fd3a0", amber: "#e8b35a", red: "#f07a62", violet: "#c5a3e0",
        "syn-comment": "#7d8f76", "syn-string": "#d9c27a", "syn-number": "#8fd3b6", "syn-keyword": "#e09a6a",
        "syn-control": "#f07a62", "syn-type": "#7ec4cf", "syn-function": "#b8d878", "syn-variable": "#e0e6d4",
        "syn-constant": "#f0a070", "syn-operator": "#a9b3a0", "syn-tag": "#7ec4cf", "syn-attr": "#d9c27a", "syn-regexp": "#f0b090",
        "syn-line": "#131a14", "syn-guide": "#1f2920", "syn-guide-active": "#3d4d3e",
      },
    },
    monocromo: {
      label: "Monocromo",
      colors: {
        bg: "#0a0a0a", rail: "#101010", sunken: "#0d0d0d", "editor-bg": "#0d0d0d",
        panel: "#161616", "panel-active": "#1e1e1e", "panel-2": "#222222", "panel-3": "#2e2e2e",
        "border-soft": "#242424", border: "#333333", "border-strong": "#474747", "border-dashed": "#525252", ghost: "#6b6b6b",
        text: "#f2f2f2", "text-2": "#d6d6d6", code: "#dcdcdc", muted: "#a0a0a0", faint: "#888888",
        accent: "#e6e6e6", "on-accent": "#0a0a0a",
        teal: "#6a6a6a", "teal-deep": "#2a2a2a", green: "#c8c8c8", amber: "#bdbdbd", red: "#ff6f5e", violet: "#b0b0b0",
        "syn-comment": "#6f6f6f", "syn-string": "#c9c9c9", "syn-number": "#e0e0e0", "syn-keyword": "#ffffff",
        "syn-control": "#ffffff", "syn-type": "#bdbdbd", "syn-function": "#f0f0f0", "syn-variable": "#d0d0d0",
        "syn-constant": "#e0e0e0", "syn-operator": "#9a9a9a", "syn-tag": "#cfcfcf", "syn-attr": "#b8b8b8", "syn-regexp": "#c0c0c0",
        "syn-line": "#151515", "syn-guide": "#262626", "syn-guide-active": "#4a4a4a",
      },
    },
  };

  const EDITABLE = [
    ["accent", "Acento"],
    ["code", "Texto del código"],
    ["syn-keyword", "Palabras clave"],
    ["syn-string", "Textos"],
    ["syn-number", "Números"],
    ["syn-comment", "Comentarios"],
    ["syn-function", "Funciones"],
    ["syn-type", "Tipos"],
    ["syn-variable", "Variables"],
    ["syn-constant", "Constantes"],
    ["syn-tag", "Etiquetas"],
  ];

  const FONTS = {
    sf: { label: "SF Mono", stack: 'ui-monospace, "SF Mono", Menlo, monospace' },
    menlo: { label: "Menlo", stack: "Menlo, monospace" },
    plex: { label: "IBM Plex Mono", stack: '"IBM Plex Mono", ui-monospace, monospace' },
    jetbrains: { label: "JetBrains Mono", stack: '"JetBrains Mono", ui-monospace, monospace' },
    fira: { label: "Fira Code", stack: '"Fira Code", ui-monospace, monospace' },
  };
  const DEFAULT_FONT = { family: "sf", size: 13, lineHeight: 1.55, ligatures: false };

  const isHex = (v) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

  // Añade un nivel de transparencia (alfa) a un color hex, devolviendo un color con alfa en formato #rrggbbaa.
  function withAlpha(hex, alpha) {
    const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
    return hex.slice(0, 7) + a.toString(16).padStart(2, "0");
  }

  // Mezcla dos colores hexadecimales en proporción t (0 a 1), devolviendo un nuevo color con los componentes mezclados.
  function mix(hex, other, t) {
    const ch = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
    return (
      "#" +
      [0, 1, 2]
        .map((i) => Math.round(ch(hex, i) + (ch(other, i) - ch(hex, i)) * t).toString(16).padStart(2, "0"))
        .join("")
    );
  }

  // Calcula los tonos suaves, de selección y los corchetes a partir de los colores base,
  // para que un tema o un color cambiado no deje tonos viejos colgando. Van en hex con
  // alfa (#rrggbbaa) y no en rgba(): Monaco solo acepta hex en su tema.
  function derive(c) {
    return {
      ...c,
      "accent-hover": mix(c.accent, "#ffffff", 0.3),
      "accent-soft": withAlpha(c.accent, 0.16),
      "accent-line": withAlpha(c.accent, 0.5),
      "accent-glow": withAlpha(c.accent, 0.8),
      "teal-soft": withAlpha(c.teal, 0.2),
      "teal-line": withAlpha(c.teal, 0.5),
      "green-soft": withAlpha(c.green, 0.16),
      "green-track": withAlpha(c.teal, 0.42),
      "amber-soft": withAlpha(c.amber, 0.14),
      "red-soft": withAlpha(c.red, 0.14),
      "red-line": withAlpha(c.red, 0.4),
      "violet-soft": withAlpha(c.violet, 0.16),
      "syn-invalid": c.red,
      "syn-selection": withAlpha(c.teal, 0.38),
      "syn-selection-soft": withAlpha(c.teal, 0.2),
      "syn-find": withAlpha(c.accent, 0.32),
      "syn-bracket-1": c["syn-function"],
      "syn-bracket-2": c["syn-keyword"],
      "syn-bracket-3": c["syn-type"],
      "syn-bracket-4": c["syn-number"],
      "syn-bracket-5": c["syn-string"],
      "syn-bracket-6": c["syn-control"],
    };
  }

  // Filtra y limpia las sobrescripciones de color del usuario, solo aceptando valores hexadecimales válidos y en minúsculas.
  function cleanOverrides(raw) {
    const out = {};
    if (!raw || typeof raw !== "object") return out;
    EDITABLE.forEach(([key]) => {
      if (isHex(raw[key])) out[key] = raw[key].toLowerCase();
    });
    return out;
  }

  // Normaliza y valida los valores de fuente: tamaño, línea y ligaturas, asegurando que estén dentro de rangos y con valores predeterminados si no están definidos.
  function cleanFont(raw) {
    const f = raw && typeof raw === "object" ? raw : {};
    const num = (v, min, max, def) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Math.min(max, Math.max(min, Number(v))) : def);
    return {
      family: FONTS[f.family] ? f.family : DEFAULT_FONT.family,
      size: num(f.size, 10, 24, DEFAULT_FONT.size),
      lineHeight: num(f.lineHeight, 1.2, 2.2, DEFAULT_FONT.lineHeight),
      ligatures: f.ligatures === true,
    };
  }

  // Limpia y valida el estado del tema desde localStorage, asegurando que los valores sean objetos y que se conviertan en valores seguros para usar en el tema.
  function cleanState(raw) {
    const s = raw && typeof raw === "object" ? raw : {};
    return {
      preset: PRESETS[s.preset] ? s.preset : "singularity",
      overrides: cleanOverrides(s.overrides),
      font: cleanFont(s.font),
    };
  }

  // Resuelve el estado completo del tema combinando el preset base con las sobrescripciones del usuario y devolviendo el color final con todos los tonos derivados.
  function resolve(state) {
    const s = cleanState(state);
    return derive({ ...PRESETS[s.preset].colors, ...s.overrides });
  }

  const api = { PRESETS, EDITABLE, FONTS, SURFACES, isHex, withAlpha, mix, derive, cleanOverrides, cleanFont, cleanState, resolve };

  if (typeof module === "object" && module.exports) {
    module.exports = api;
    return;
  }

  const docRoot = document.documentElement;

  // Carga el estado del tema desde localStorage, tratando errores si el JSON está roto o vacío, devolviendo un estado válido por defecto.
  function load() {
    try {
      return cleanState(JSON.parse(localStorage.getItem(KEY) || "null"));
    } catch {
      return cleanState(null);
    }
  }

  let state = load();
  let colors = resolve(state);

  // Escribe los colores inline en :root, por encima de styles.css, que solo vale como
  // valor de arranque antes de que corra este script.
  function apply() {
    colors = resolve(state);
    Object.entries(colors).forEach(([name, value]) => docRoot.style.setProperty(`--${name}`, value));
  }

  // API del navegador. set guarda en localStorage, reaplica, pide al velo que recalcule
  // su alfa sobre las superficies nuevas y avisa con theme:change a Monaco y xterm.
  root.Theme = {
    ...api,
    state: () => JSON.parse(JSON.stringify(state)),
    color: (name) => colors[name.replace(/^--/, "")],
    colors: () => ({ ...colors }),
    font: () => ({ ...state.font, stack: FONTS[state.font.family].stack }),
    set(next) {
      state = cleanState({
        preset: next.preset !== undefined ? next.preset : state.preset,
        overrides: next.overrides !== undefined ? next.overrides : state.overrides,
        font: next.font !== undefined ? { ...state.font, ...next.font } : state.font,
      });
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
      } catch {}
      apply();
      if (root.Veil && root.Veil.refresh) root.Veil.refresh();
      document.dispatchEvent(new CustomEvent("theme:change"));
    },
  };

  apply();
})(typeof window !== "undefined" ? window : globalThis);
