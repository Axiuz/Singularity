// Catálogo de cómo compilar, ejecutar y depurar un archivo suelto según su
// extensión. Sin estado: planFor() no ejecuta nada, solo dice qué se lanzaría.
// Depurar usa el Debug Adapter Protocol: lldb-dap para C, C++, Swift y Rust,
// debugpy para Python. JS/TS, Java, Kotlin y Go de momento solo se ejecutan.
// El servidor no hereda el PATH del shell de login: los binarios se buscan en
// las rutas habituales y, en macOS, con xcrun -f, que es donde vive lldb-dap.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

// El binario compilado se almacena en os.tmpdir()/singularity-run para evitar ensuciar el repositorio del usuario.
const OUT_DIR = path.join(os.tmpdir(), "singularity-run");

const LANGS = [
  { id: "c", label: "C", exts: [".c"], build: (f, out) => ["clang", ["-g", "-O0", f, "-o", out]], run: (f, out) => [out, []], debug: "lldb" },
  {
    id: "cpp",
    label: "C++",
    exts: [".cpp", ".cc", ".cxx"],
    build: (f, out) => ["clang++", ["-g", "-O0", "-std=c++17", f, "-o", out]],
    run: (f, out) => [out, []],
    debug: "lldb",
  },
  { id: "swift", label: "Swift", exts: [".swift"], build: (f, out) => ["swiftc", ["-g", "-Onone", f, "-o", out]], run: (f, out) => [out, []], debug: "lldb" },
  { id: "rust", label: "Rust", exts: [".rs"], build: (f, out) => ["rustc", ["-g", f, "-o", out]], run: (f, out) => [out, []], debug: "lldb" },
  { id: "python", label: "Python", exts: [".py"], run: (f) => ["python3", ["-u", f]], debug: "debugpy" },
  { id: "javascript", label: "JavaScript", exts: [".js", ".mjs", ".cjs"], run: (f) => ["node", [f]] },
  { id: "typescript", label: "TypeScript", exts: [".ts", ".mts", ".cts"], run: (f) => ["node", [f]] },
  { id: "java", label: "Java", exts: [".java"], run: (f) => ["java", [f]] },
  {
    id: "kotlin",
    label: "Kotlin",
    exts: [".kt"],
    build: (f, out) => ["kotlinc", [f, "-include-runtime", "-d", `${out}.jar`]],
    run: (f, out) => ["java", ["-jar", `${out}.jar`]],
  },
  { id: "go", label: "Go", exts: [".go"], run: (f) => ["go", ["run", f]] },
  { id: "ruby", label: "Ruby", exts: [".rb"], run: (f) => ["ruby", [f]] },
  { id: "php", label: "PHP", exts: [".php"], run: (f) => ["php", [f]] },
  { id: "shell", label: "Shell", exts: [".sh", ".bash", ".zsh"], run: (f) => [f.endsWith(".zsh") ? "zsh" : "bash", [f]] },
];

const ADAPTERS = {
  lldb: {
    bin: "lldb-dap",
    args: [],
    launch: ({ out, cwd }) => ({ program: out, cwd, args: [], stopOnEntry: false }),
  },
  debugpy: {
    bin: "python3",
    args: ["-m", "debugpy.adapter"],
    module: "debugpy",
    install: "python3 -m pip install --user debugpy",
    launch: ({ file, cwd }) => ({ type: "python", request: "launch", program: file, cwd, console: "internalConsole", justMyCode: true }),
  },
};

// Lista blanca de órdenes que el panel puede mandar al adaptador: launch,
// attach y disconnect quedan fuera porque launch decide qué se ejecuta.
const ALLOWED_REQUESTS = new Set([
  "continue",
  "next",
  "stepIn",
  "stepOut",
  "pause",
  "threads",
  "stackTrace",
  "scopes",
  "variables",
  "evaluate",
  "setBreakpoints",
]);

// Añade rutas comunes del sistema (homebrew, cargo, go) al PATH para localizar binarios.
function binDirs(env = process.env) {
  const home = env.HOME || os.homedir();
  return [
    ...String(env.PATH || "").split(path.delimiter),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    path.join(home, ".cargo", "bin"),
    path.join(home, "go", "bin"),
    "/usr/local/go/bin",
    path.join(home, ".local", "bin"),
  ].filter(Boolean);
}

// Busca binarios en el PATH y en rutas habituales; en macOS, usa xcrun -f para localizar herramientas como lldb-dap.
function makeFinder(env = process.env) {
  const cache = new Map();
  return (name) => {
    if (path.isAbsolute(name)) return name;
    if (cache.has(name)) return cache.get(name);
    let found = null;
    for (const dir of binDirs(env)) {
      const full = path.join(dir, name);
      try {
        fs.accessSync(full, fs.constants.X_OK);
        if (fs.statSync(full).isFile()) {
          found = full;
          break;
        }
      } catch (_) {}
    }
    if (!found && process.platform === "darwin") {
      try {
        found = execFileSync("/usr/bin/xcrun", ["-f", name], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
      } catch (_) {}
    }
    cache.set(name, found);
    return found;
  };
}

function langFor(file) {
  const ext = path.extname(String(file || "")).toLowerCase();
  return LANGS.find((l) => l.exts.includes(ext)) || null;
}

// Limpia el nombre del archivo para eliminar espacios y caracteres raros, asegurando que sea válido en comandos.
function outPath(file, outDir = OUT_DIR) {
  const base = path.basename(file, path.extname(file)).replace(/[^A-Za-z0-9_-]/g, "_") || "programa";
  return path.join(outDir, base);
}

// No ejecuta nada: solo planifica el flujo de compilación, ejecución y depuración.
// Permite probar sin acceder al disco, usando find y hasModule para verificar dependencias.
function planFor(file, { find, hasModule = () => true, outDir = OUT_DIR } = {}) {
  const lang = langFor(file);
  if (!lang) return null;
  const out = outPath(file, outDir);
  const cwd = path.dirname(file);
  const missing = [];
  const resolve = ([cmd, args]) => {
    const bin = find(cmd);
    if (!bin) missing.push(cmd);
    return { cmd: bin || cmd, args };
  };

  const steps = [];
  if (lang.build) steps.push({ kind: "build", ...resolve(lang.build(file, out)) });
  const run = resolve(lang.run(file, out));

  let debug = null;
  const adapter = lang.debug && ADAPTERS[lang.debug];
  if (adapter) {
    const bin = find(adapter.bin);
    const absent = [];
    if (!bin) absent.push(adapter.bin);
    if (bin && adapter.module && !hasModule(adapter.module)) absent.push(adapter.module);
    debug = {
      adapter: lang.debug,
      cmd: bin || adapter.bin,
      args: adapter.args,
      launch: adapter.launch({ file, out, cwd }),
      missing: absent,
      install: absent.length ? adapter.install || null : null,
    };
  }

  return { lang: lang.id, label: lang.label, file, cwd, out, steps, run: { kind: "run", ...run }, debug, missing };
}

// Verifica si Python tiene un módulo específico instalado, usando python3 -c para probar import.
function pythonHasModule(find) {
  return (name) => {
    const py = find("python3");
    if (!py) return false;
    try {
      execFileSync(py, ["-c", `import ${name}`], { timeout: 8000, stdio: "ignore" });
      return true;
    } catch (_) {
      return false;
    }
  };
}

function requestError(command) {
  return ALLOWED_REQUESTS.has(command) ? null : "Esa orden no se admite";
}

module.exports = { OUT_DIR, LANGS, ADAPTERS, ALLOWED_REQUESTS, binDirs, makeFinder, langFor, outPath, planFor, pythonHasModule, requestError };
