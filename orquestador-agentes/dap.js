// Cliente del Debug Adapter Protocol y gestor de la única ejecución en marcha
// del editor: la segunda recibe 409 en el servidor. Compila con los pasos de
// runners.js y luego ejecuta el programa tal cual o arranca su adaptador DAP
// por stdio. La salida va por SSE en ráfagas y queda un log para reconectar.

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const runners = require("./runners");

const LIMITS = {
  log: 300000,
  flushMs: 80,
  requestMs: 15000,
  initMs: 20000,
  killMs: 3000,
};

function encode(msg) {
  const body = Buffer.from(JSON.stringify(msg), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]);
}

// Analiza el flujo de datos del adaptador DAP, reconstruyendo mensajes JSON
// incluso si llegan fragmentados. Trabaja sobre Buffer porque Content-Length
// cuenta bytes y un carácter multibyte puede llegar partido entre dos trozos.
function createParser(onMessage) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8")]);
    for (;;) {
      const end = buf.indexOf("\r\n\r\n");
      if (end < 0) return;
      const match = /Content-Length:\s*(\d+)/i.exec(buf.subarray(0, end).toString("ascii"));
      if (!match) {
        buf = buf.subarray(end + 4);
        continue;
      }
      const start = end + 4;
      const len = Number(match[1]);
      if (buf.length < start + len) return;
      const body = buf.subarray(start, start + len).toString("utf8");
      buf = buf.subarray(start + len);
      let msg;
      try {
        msg = JSON.parse(body);
      } catch (_) {
        continue;
      }
      onMessage(msg);
    }
  };
}

function create({ onEvent = () => {}, env = process.env } = {}) {
  let job = null;
  let counter = 0;

  const childEnv = () => ({ ...env, PATH: runners.binDirs(env).join(path.delimiter), TERM: "dumb", NO_COLOR: "1", PYTHONUNBUFFERED: "1" });

  const view = () =>
    job && {
      id: job.id,
      file: job.plan.file,
      lang: job.plan.lang,
      label: job.plan.label,
      debug: job.debug,
      phase: job.phase,
      running: job.running,
      threadId: job.threadId,
      exitCode: job.exitCode,
      error: job.error,
    };

  const emitState = () => onEvent("state", view());

  function output(category, text) {
    if (!job || !text) return;
    job.log.push({ category, text });
    job.logSize += text.length;
    while (job.logSize > LIMITS.log && job.log.length > 1) job.logSize -= job.log.shift().text.length;
    job.outbox.push({ category, text });
    if (job.flush) return;
    job.flush = setTimeout(() => flushNow(job), LIMITS.flushMs);
  }

  function flushNow(target) {
    clearTimeout(target.flush);
    target.flush = null;
    if (!target.outbox.length) return;
    onEvent("output", { id: target.id, chunks: target.outbox.splice(0) });
  }

  // Mata el grupo de procesos del hijo (con pid negativo): el adaptador arranca
  // a su vez el programa depurado, y matar solo al padre lo dejaría huérfano.
  function killGroup(child, signal) {
    if (!child || child.exitCode !== null || child.signalCode) return;
    try {
      process.kill(-child.pid, signal);
    } catch (_) {
      try {
        child.kill(signal);
      } catch (_) {}
    }
  }

  // Finaliza una sesión de depuración, guarda el código de salida, limpia
  // peticiones pendientes y mata el adaptador si es necesario. Recibe la sesión
  // explícita: una sesión vieja que termina tarde no debe cerrar la nueva.
  function finish(code, error, current = job) {
    if (!current || !current.running) return;
    current.running = false;
    current.phase = "exited";
    if (code !== undefined && current.exitCode === null) current.exitCode = code;
    if (error) current.error = error;
    for (const { reject, timer } of current.pending.values()) {
      clearTimeout(timer);
      reject(new Error("La sesión terminó"));
    }
    current.pending.clear();
    if (current.adapter) {
      const adapter = current.adapter;
      setTimeout(() => killGroup(adapter, "SIGKILL"), LIMITS.killMs);
    }
    if (current !== job) return;
    if (error) output("error", `${error}\n`);
    output("info", `\nTerminado${current.exitCode !== null ? ` con código ${current.exitCode}` : ""}.\n`);
    flushNow(current);
    emitState();
    if (current.onFinish) current.onFinish();
  }

  function spawnStep(step, cwd) {
    return spawn(step.cmd, step.args, { cwd, env: childEnv(), detached: true, stdio: ["ignore", "pipe", "pipe"] });
  }

  // Ejecuta un paso de compilación y devuelve una promesa con el resultado,
  // mostrando salida en tiempo real y capturando errores o fallos.
  function runBuild(step, cwd) {
    return new Promise((resolve) => {
      output("info", `$ ${[path.basename(step.cmd), ...step.args].join(" ")}\n`);
      const current = job;
      const child = spawnStep(step, cwd);
      current.child = child;
      child.stdout.on("data", (d) => job === current && output("stdout", d.toString()));
      child.stderr.on("data", (d) => job === current && output("stderr", d.toString()));
      child.on("error", (err) => resolve({ ok: false, error: err.message }));
      child.on("close", (code) => resolve({ ok: code === 0, error: code === 0 ? null : `La compilación falló (código ${code})` }));
    });
  }

  function runPlain(step, cwd) {
    output("info", `$ ${[path.basename(step.cmd), ...step.args].join(" ")}\n`);
    const current = job;
    const child = spawnStep(step, cwd);
    current.child = child;
    current.phase = "running";
    emitState();
    child.stdout.on("data", (d) => job === current && output("stdout", d.toString()));
    child.stderr.on("data", (d) => job === current && output("stderr", d.toString()));
    child.on("error", (err) => finish(null, err.message, current));
    child.on("close", (code, signal) => finish(code === null ? (signal ? -1 : null) : code, undefined, current));
  }

  function send(msg) {
    if (!job || !job.adapter || !job.adapter.stdin.writable) return;
    job.adapter.stdin.write(encode(msg));
  }

  // Envía una petición al adaptador DAP con tiempo de espera, y maneja
  // respuestas o timeouts para evitar bloqueos.
  function request(command, args = {}, timeoutMs = LIMITS.requestMs) {
    if (!job || !job.running || !job.adapter) return Promise.reject(new Error("No hay ninguna sesión de depuración"));
    const current = job;
    const seq = ++current.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        current.pending.delete(seq);
        reject(new Error(`El depurador no respondió a ${command}`));
      }, timeoutMs);
      current.pending.set(seq, { resolve, reject, timer, command });
      send({ seq, type: "request", command, arguments: args });
    });
  }

  // Maneja los mensajes del adaptador: respuestas, eventos y peticiones inversas.
  // Estas (runInTerminal, startDebugging) se rechazan: no se anuncian en initialize.
  function onAdapterMessage(msg) {
    if (!job) return;
    if (msg.type === "response") {
      const waiting = job.pending.get(msg.request_seq);
      if (!waiting) return;
      job.pending.delete(msg.request_seq);
      clearTimeout(waiting.timer);
      if (msg.success) waiting.resolve(msg.body || {});
      else waiting.reject(new Error(msg.message || (msg.body && msg.body.error && msg.body.error.format) || `${waiting.command} falló`));
      return;
    }
    if (msg.type === "request") {
      send({ seq: ++job.seq, type: "response", request_seq: msg.seq, command: msg.command, success: false, message: "No soportado" });
      return;
    }
    if (msg.type !== "event") return;
    const body = msg.body || {};
    switch (msg.event) {
      case "initialized":
        if (job.onInitialized) job.onInitialized();
        break;
      case "output":
        if (body.category !== "telemetry") output(body.category || "console", body.output || "");
        break;
      case "stopped":
        job.phase = "stopped";
        job.threadId = body.threadId || job.threadId || null;
        flushNow(job);
        emitState();
        onEvent("stopped", { id: job.id, ...body, threadId: job.threadId });
        break;
      case "continued":
        job.phase = "running";
        emitState();
        break;
      case "exited":
        job.exitCode = body.exitCode;
        break;
      case "terminated":
        finish();
        break;
      default:
        break;
    }
  }

  // Cada manejador comprueba job === current: el adaptador de una sesión anterior
  // puede cerrarse tarde y, sin eso, terminaba la sesión nueva.
  async function startDebug(plan, breakpoints) {
    const { debug } = plan;
    output("info", `Depurando con ${path.basename(debug.cmd)}…\n`);
    const adapter = spawn(debug.cmd, debug.args, { cwd: plan.cwd, env: childEnv(), detached: true, stdio: ["pipe", "pipe", "pipe"] });
    const current = job;
    current.adapter = adapter;
    adapter.stdout.on("data", createParser((msg) => job === current && onAdapterMessage(msg)));
    adapter.stderr.on("data", (d) => job === current && output("stderr", d.toString()));
    adapter.on("error", (err) => finish(null, err.message, current));
    adapter.on("close", () => finish(undefined, undefined, current));

    const initialized = new Promise((resolve, reject) => {
      job.onInitialized = resolve;
      setTimeout(() => reject(new Error("El depurador no terminó de arrancar")), LIMITS.initMs);
    });

    await request("initialize", {
      clientID: "singularity",
      clientName: "Singularity",
      adapterID: debug.adapter,
      locale: "es",
      linesStartAt1: true,
      columnsStartAt1: true,
      pathFormat: "path",
      supportsVariableType: true,
      supportsRunInTerminalRequest: false,
    });
    // launch no se espera aquí: debugpy no contesta hasta después de
    // configurationDone, y los breakpoints van entre medias, al llegar initialized.
    const launched = request("launch", debug.launch, LIMITS.initMs);
    launched.catch(() => {});
    await initialized;
    for (const [file, lines] of Object.entries(breakpoints || {})) {
      await request("setBreakpoints", { source: { path: file }, breakpoints: lines.map((line) => ({ line })) }).catch((err) =>
        output("error", `Breakpoints de ${path.basename(file)}: ${err.message}\n`)
      );
    }
    await request("setExceptionBreakpoints", { filters: [] }).catch(() => {});
    await request("configurationDone").catch(() => {});
    await launched;
    if (job && job.running && job.phase !== "stopped") {
      job.phase = "running";
      emitState();
    }
  }

  function start({ plan, debug = false, breakpoints = {} }) {
    if (job && job.running) return { ok: false, output: "Ya hay un programa en marcha: páralo antes" };
    if (debug && !plan.debug) return { ok: false, output: `${plan.label} todavía no se puede depurar desde aquí` };
    const missing = [...plan.missing, ...(debug ? plan.debug.missing : [])];
    if (missing.length) return { ok: false, output: `Falta en este Mac: ${missing.join(", ")}`, install: debug ? plan.debug.install : null };

    job = {
      id: `run-${++counter}`,
      plan,
      debug,
      phase: "building",
      running: true,
      threadId: null,
      exitCode: null,
      error: null,
      log: [],
      logSize: 0,
      outbox: [],
      flush: null,
      child: null,
      adapter: null,
      seq: 0,
      pending: new Map(),
      onInitialized: null,
      onFinish: null,
    };
    const current = job;
    emitState();

    (async () => {
      try {
        fs.mkdirSync(path.dirname(plan.out), { recursive: true });
        for (const step of plan.steps) {
          const built = await runBuild(step, plan.cwd);
          if (job !== current || !current.running) return;
          if (!built.ok) return finish(null, built.error);
        }
        if (debug) await startDebug(plan, breakpoints);
        else runPlain(plan.run, plan.cwd);
      } catch (err) {
        if (job === current) {
          finish(null, err.message);
          killGroup(current.adapter, "SIGKILL");
        }
      }
    })();
    return { ok: true, state: view() };
  }

  // Espera a que el proceso muera de verdad (con tope) para que Reiniciar no
  // choque con la sesión vieja.
  async function stop() {
    if (!job || !job.running) return false;
    const current = job;
    const ended = new Promise((resolve) => {
      current.onFinish = resolve;
      setTimeout(resolve, LIMITS.killMs + 500);
    });
    if (current.adapter) await request("disconnect", { terminateDebuggee: true }, 2000).catch(() => {});
    killGroup(current.adapter, "SIGTERM");
    killGroup(current.child, "SIGTERM");
    setTimeout(() => {
      killGroup(current.child, "SIGKILL");
      killGroup(current.adapter, "SIGKILL");
    }, LIMITS.killMs);
    await ended;
    if (job === current) finish();
    return true;
  }

  function stopAll() {
    if (!job) return;
    killGroup(job.child, "SIGTERM");
    killGroup(job.adapter, "SIGTERM");
  }

  const state = () => view();
  const log = () => (job ? job.log.slice() : []);
  const running = () => Boolean(job && job.running);

  return { start, stop, stopAll, request, state, log, running };
}

module.exports = { LIMITS, encode, createParser, create };
