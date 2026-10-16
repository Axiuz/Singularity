// Adaptador del Protocolo de Depuración (DAP) para depurar JavaScript y TypeScript desde Singularity.
// Lanza Node con --inspect-brk y traduce órdenes DAP (breakpoints, pasos, pila, variables, evaluación)
// al Chrome DevTools Protocol mediante WebSocket de Node 22+.
// Funciona sin dependencias, con soporte para TypeScript gracias a la eliminación de tipos en Node 24.
// Limitación: solo un archivo, sin workers ni procesos hijos.

const { spawn } = require("child_process");
const { pathToFileURL, fileURLToPath } = require("url");
const path = require("path");
const { encode, createParser } = require("./dap");

const THREAD_ID = 1;
const MAX_PROPS = 500;
const INSPECTOR_NOISE = [/^Debugger listening on /, /^For help, see: /, /^Debugger attached\./, /^Waiting for the debugger to disconnect\.\.\./];

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Crea una expresión regular que matchea tanto la URL file:// como la ruta plana,
// porque Node reporta scripts en diferentes formatos (CommonJS vs ESM) según versión.
function urlRegexFor(file) {
  return `^(${escapeRegex(pathToFileURL(file).href)}|${escapeRegex(file)})$`;
}

// Extrae la ruta local de una URL, usando fileURLToPath si es file://,
// o devuelve null si no es una ruta absoluta válida.
function fileFromUrl(url) {
  if (!url) return null;
  if (url.startsWith("file://")) {
    try {
      return fileURLToPath(url);
    } catch (_) {
      return null;
    }
  }
  return path.isAbsolute(url) ? url : null;
}

// Formatea el valor de un objeto en el inspector: devuelve el valor o una descripción
// basada en su tipo, evitando serializar objetos no serializables.
function describe(obj) {
  if (!obj) return "undefined";
  if (obj.unserializableValue) return obj.unserializableValue;
  switch (obj.type) {
    case "undefined":
      return "undefined";
    case "string":
      return JSON.stringify(obj.value);
    case "number":
    case "boolean":
      return String(obj.value);
    case "object":
      if (obj.subtype === "null") return "null";
      return obj.description || "Object";
    default:
      return obj.description !== undefined ? obj.description : String(obj.value);
  }
}

const hasChildren = (obj) => Boolean(obj && obj.objectId && obj.subtype !== "null" && (obj.type === "object" || obj.type === "function"));

// Determina el motivo de pausa en el depurador: breakpoint, excepción, paso o pausa manual.
// Prioriza el estado del parámetro params sobre lastAction para ser más preciso.
function stopReason(params, lastAction) {
  if (params.hitBreakpoints && params.hitBreakpoints.length) return "breakpoint";
  if (params.reason === "exception" || params.reason === "promiseRejection") return "exception";
  if (lastAction === "pause") return "pause";
  if (lastAction === "step") return "step";
  return params.reason === "debugCommand" ? "pause" : "breakpoint";
}

// Filtra líneas del stderr del inspector que son mensajes de depuración o no relevantes,
// como "Debugger listening" o "Waiting for debugger", para evitar ruido en la salida.
function isNoise(line) {
  return INSPECTOR_NOISE.some((re) => re.test(line.trim()));
}

// Crea un adaptador DAP para conectar con el depurador de Node, usando el proceso hijo
// y el WebSocket para comunicarse con el inspector; permite inyectar mocks para pruebas.
function createAdapter({ write, exit, spawnNode = defaultSpawn, connect = defaultConnect }) {
  let seq = 0;
  let child = null;
  let ws = null;
  let cdpSeq = 0;
  const cdpPending = new Map();
  const scripts = new Map();
  const fileBreakpoints = new Map();
  let frames = null;
  let refs = new Map();
  let nextRef = 1;
  let configured = false;
  let entryPaused = false;
  let sawEntry = false;
  let lastAction = null;
  let ended = false;

  const sendDap = (msg) => write(encode({ seq: ++seq, ...msg }));
  const event = (name, body = {}) => sendDap({ type: "event", event: name, body });
  const output = (category, text) => text && event("output", { category, output: text });

  // Envía un mensaje al inspector de Node a través del WebSocket, devuelve una promesa
  // que resuelve con el resultado o rechaza si hay error (por ejemplo, si el inspector no está conectado).
  function cdp(method, params = {}) {
    if (!ws) return Promise.reject(new Error("El inspector de Node no está conectado"));
    const id = ++cdpSeq;
    return new Promise((resolve, reject) => {
      cdpPending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  // Asigna un identificador único a un objeto en el contexto de depuración para referencias
  // en variables y scopes, evitando duplicados y permitiendo seguir el estado de objetos.
  function refFor(objectId) {
    const ref = nextRef++;
    refs.set(ref, objectId);
    return ref;
  }

  // Crea un objeto con descripción de variable, incluyendo valor, tipo y referencia a variables
  // si el objeto tiene hijos (como objetos o funciones), para mostrar en el panel de depuración.
  function variable(name, obj) {
    return {
      name,
      value: describe(obj),
      type: obj ? obj.subtype || obj.type : "undefined",
      variablesReference: hasChildren(obj) ? refFor(obj.objectId) : 0,
    };
  }

  // Maneja mensajes del inspector de Node: actualiza scripts, pausas, reanudaciones y cierra el
  // WebSocket si el contexto se destruye, evitando que el proceso se quede esperando.
  function onCdpMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
    } catch (_) {
      return;
    }
    if (msg.id) {
      const waiting = cdpPending.get(msg.id);
      if (!waiting) return;
      cdpPending.delete(msg.id);
      if (msg.error) waiting.reject(new Error(msg.error.message || "Error del inspector"));
      else waiting.resolve(msg.result || {});
      return;
    }
    const params = msg.params || {};
    switch (msg.method) {
      case "Debugger.scriptParsed":
        scripts.set(params.scriptId, params.url);
        break;
      case "Debugger.paused":
        // La primera pausa es el 'Break on start' de --inspect-brk: no se avisa al panel
        // y se reanuda en configurationDone, con los breakpoints ya puestos.
        // refs se vacía porque los objectId de CDP dejan de valer al reanudar.
        frames = params.callFrames || [];
        refs = new Map();
        if (!sawEntry) {
          sawEntry = true;
          if (configured) cdp("Debugger.resume").catch(() => {});
          else entryPaused = true;
          return;
        }
        event("stopped", { reason: stopReason(params, lastAction), threadId: THREAD_ID, allThreadsStopped: true });
        lastAction = null;
        break;
      case "Debugger.resumed":
        frames = null;
        refs = new Map();
        if (configured) event("continued", { threadId: THREAD_ID, allThreadsContinued: true });
        break;
      case "Runtime.executionContextDestroyed":
        if (ws) ws.close();
        break;
      default:
        break;
    }
  }

  // Cierra la sesión una sola vez: rechaza las peticiones al inspector que quedaban
  // pendientes y avisa al panel con exited y terminated.
  function finish(code) {
    if (ended) return;
    ended = true;
    for (const waiting of cdpPending.values()) waiting.reject(new Error("El programa terminó"));
    cdpPending.clear();
    event("exited", { exitCode: code === null || code === undefined ? 0 : code });
    event("terminated");
    exit();
  }

  // Filtra y envía la salida del proceso al canal de salida adecuado (stdout/stderr),
  // eliminando líneas de ruido (como mensajes del inspector) para mantener la salida limpia.
  function pipeOutput(stream, category, filter) {
    let pending = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      if (!filter) return output(category, chunk);
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop();
      const kept = lines.filter((l) => !isNoise(l));
      if (kept.length) output(category, kept.join("\n") + "\n");
    });
    stream.on("end", () => pending && !isNoise(pending) && output(category, pending));
  }

  // Espera a que el proceso Node abra el inspector (Debugger listening), devuelve la URL
  // del WebSocket, y rechaza si el proceso termina antes de abrirlo.
  function waitForInspector(proc) {
    return new Promise((resolve, reject) => {
      let seen = "";
      const onData = (chunk) => {
        seen += chunk.toString();
        const match = /Debugger listening on (ws:\/\/\S+)/.exec(seen);
        if (match) {
          proc.stderr.off("data", onData);
          resolve(match[1]);
        }
      };
      proc.stderr.on("data", onData);
      proc.on("exit", () => reject(new Error(seen.trim() || "Node terminó antes de abrir el inspector")));
    });
  }

  // Inicia el proceso Node con --inspect-brk, espera a que el inspector se abra,
  // conecta al WebSocket y habilita el depurador; el programa sigue en la pausa de
// entrada hasta configurationDone.
  async function launch(args) {
    const program = args.program;
    child = spawnNode(program, args.cwd || path.dirname(program));
    const wsUrl = await waitForInspector(child);
    pipeOutput(child.stdout, "stdout", false);
    pipeOutput(child.stderr, "stderr", true);
    child.on("exit", (code) => finish(code));
    ws = await connect(wsUrl);
    ws.addEventListener("message", (e) => onCdpMessage(e.data));
    ws.addEventListener("close", () => {
      ws = null;
    });
    await cdp("Runtime.enable");
    await cdp("Debugger.enable");
    await cdp("Debugger.setBlackboxPatterns", { patterns: ["^node:"] }).catch(() => {});
    await cdp("Runtime.runIfWaitingForDebugger");
  }

  // Establece breakpoints usando urlRegexFor para que valgan también para scripts no cargados,
  // y devuelve un listado de verificaciones (exitó o no) para el panel de depuración.
  async function setBreakpoints(args) {
    const file = args.source && args.source.path;
    for (const id of fileBreakpoints.get(file) || []) await cdp("Debugger.removeBreakpoint", { breakpointId: id }).catch(() => {});
    const ids = [];
    const result = [];
    for (const bp of args.breakpoints || []) {
      try {
        const res = await cdp("Debugger.setBreakpointByUrl", { lineNumber: bp.line - 1, urlRegex: urlRegexFor(file) });
        ids.push(res.breakpointId);
        const loc = res.locations && res.locations[0];
        result.push({ verified: true, line: loc ? loc.lineNumber + 1 : bp.line });
      } catch (err) {
        result.push({ verified: false, line: bp.line, message: err.message });
      }
    }
    fileBreakpoints.set(file, ids);
    return { breakpoints: result };
  }

  // Devuelve el stack trace con información de función, línea y archivo, usando el contexto
  // del depurador para construir una representación legible del estado actual.
  function stackTrace() {
    const list = (frames || []).map((f, i) => {
      const url = scripts.get(f.location.scriptId) || f.url || "";
      const file = fileFromUrl(url);
      return {
        id: i,
        name: f.functionName || "(anónima)",
        source: file ? { name: path.basename(file), path: file } : { name: url || "(interno)", presentationHint: "deemphasize" },
        line: f.location.lineNumber + 1,
        column: (f.location.columnNumber || 0) + 1,
      };
    });
    return { stackFrames: list, totalFrames: list.length };
  }

  const SCOPE_NAMES = { local: "Local", closure: "Closure", block: "Bloque", script: "Script", module: "Módulo", global: "Global", catch: "Catch", with: "With", eval: "Eval" };

  // Devuelve los alcances (scopes) de una pila de ejecución, con nombres como "Local", "Global"
  // y referencias a variables, para mostrar el contexto en el panel de depuración.
  function scopes(args) {
    const frame = frames && frames[args.frameId];
    if (!frame) throw new Error("Ese frame ya no existe");
    return {
      scopes: frame.scopeChain.map((s) => ({
        name: SCOPE_NAMES[s.type] || s.type,
        variablesReference: refFor(s.object.objectId),
        expensive: s.type === "global",
      })),
    };
  }

  // Obtiene las variables de un alcance, usando el ID de objeto, y devuelve una lista
  // con nombre, valor y referencia si tiene hijos, evitando el ruido de propiedades no visibles.
  async function variables(args) {
    const objectId = refs.get(args.variablesReference);
    if (!objectId) return { variables: [] };
    const res = await cdp("Runtime.getProperties", { objectId, ownProperties: true, generatePreview: false });
    const props = (res.result || []).filter((p) => p.value !== undefined || p.get).slice(0, MAX_PROPS);
    return { variables: props.map((p) => (p.value !== undefined ? variable(p.name, p.value) : { name: p.name, value: "(getter)", variablesReference: 0 })) };
  }

  // Evalúa una expresión en el contexto actual, devolviendo el valor y tipo, y lanzando
  // una excepción si hay un error en la evaluación.
  async function evaluate(args) {
    const frame = frames && args.frameId !== undefined ? frames[args.frameId] : null;
    const res = frame
      ? await cdp("Debugger.evaluateOnCallFrame", { callFrameId: frame.callFrameId, expression: args.expression, generatePreview: false })
      : await cdp("Runtime.evaluate", { expression: args.expression, generatePreview: false });
    if (res.exceptionDetails) {
      const ex = res.exceptionDetails.exception;
      throw new Error(ex ? describe(ex) : res.exceptionDetails.text);
    }
    const v = variable("", res.result);
    return { result: v.value, type: v.type, variablesReference: v.variablesReference };
  }

  // Envía una acción de paso (stepOver, stepInto, stepOut) al depurador, actualizando
  // el estado de la ejecución y el último comando ejecutado.
  const step = (method) => {
    lastAction = "step";
    return cdp(method).then(() => ({}));
  };

  // Órdenes DAP que entiende el adaptador; dap.js solo deja pasar las de la lista
  // blanca de runners.js más las de arranque y cierre.
  const handlers = {
    initialize: () => ({ supportsConfigurationDoneRequest: true, supportsTerminateRequest: true }),
    launch: async (args) => {
      await launch(args);
      setImmediate(() => event("initialized"));
      return {};
    },
    setBreakpoints,
    setExceptionBreakpoints: () => cdp("Debugger.setPauseOnExceptions", { state: "none" }).then(() => ({})),
    configurationDone: async () => {
      configured = true;
      if (entryPaused) {
        entryPaused = false;
        await cdp("Debugger.resume");
      }
      return {};
    },
    threads: () => ({ threads: [{ id: THREAD_ID, name: "main" }] }),
    stackTrace,
    scopes,
    variables,
    evaluate,
    continue: () => cdp("Debugger.resume").then(() => ({ allThreadsContinued: true })),
    next: () => step("Debugger.stepOver"),
    stepIn: () => step("Debugger.stepInto"),
    stepOut: () => step("Debugger.stepOut"),
    pause: () => {
      lastAction = "pause";
      return cdp("Debugger.pause").then(() => ({}));
    },
    disconnect: () => {
      if (child && child.exitCode === null) child.kill("SIGTERM");
      return {};
    },
    terminate: () => {
      if (child && child.exitCode === null) child.kill("SIGTERM");
      return {};
    },
  };

  // Atiende una petición DAP y contesta con éxito o error; tras disconnect sale si
  // el programa ya terminó, porque entonces no llegará ningún exit del hijo.
  async function handle(msg) {
    if (msg.type !== "request") return;
    const fn = handlers[msg.command];
    const reply = (success, extra) => sendDap({ type: "response", request_seq: msg.seq, command: msg.command, success, ...extra });
    if (!fn) return reply(false, { message: `${msg.command} no está soportado` });
    try {
      reply(true, { body: (await fn(msg.arguments || {})) || {} });
    } catch (err) {
      reply(false, { message: err.message });
    }
    if (msg.command === "disconnect" && (!child || child.exitCode !== null)) exit();
  }

  return { handle, finish, kill: () => child && child.exitCode === null && child.kill("SIGKILL") };
}

// Crea un proceso Node con --inspect-brk, usando el mismo ejecutable que el adaptador,
// para garantizar compatibilidad con el depurador y el WebSocket.
function defaultSpawn(program, cwd) {
  return spawn(process.execPath, ["--inspect-brk=127.0.0.1:0", program], { cwd, stdio: ["ignore", "pipe", "pipe"] });
}

// Conecta al inspector de Node usando WebSocket, y rechaza si Node es anterior a v22
// (que requiere WebSocket nativo para el depurador).
function defaultConnect(url) {
  if (typeof WebSocket !== "function") return Promise.reject(new Error("Depurar JavaScript necesita Node 22 o superior"));
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => resolve(ws), { once: true });
    ws.addEventListener("error", () => reject(new Error("No se pudo conectar con el inspector de Node")), { once: true });
  });
}

if (require.main === module) {
  const adapter = createAdapter({
    write: (buf) => process.stdout.write(buf),
    exit: () => setTimeout(() => process.exit(0), 50),
  });
  process.stdin.on("data", createParser((msg) => adapter.handle(msg)));
  process.stdin.on("end", () => {
    adapter.kill();
    process.exit(0);
  });
}

module.exports = { urlRegexFor, fileFromUrl, describe, hasChildren, stopReason, isNoise, createAdapter };
