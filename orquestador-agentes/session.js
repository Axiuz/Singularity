// Decide con qué CLI (Claude Code, Antigravity CLI, Codex CLI) arranca la pestaña Sesión
// y qué partes de las instrucciones cambian según la CLI y el modo de trabajo (local
// con agentes de LM Studio, solo IA de pago, o IA de pago con sus propios subagentes).

const CLIS = {
  claude: { name: "Claude Code" },
  antigravity: { name: "Antigravity CLI" },
  codex: { name: "Codex CLI" },
};
const MODES = ["local", "solo", "subagents"];

// Cualquier valor raro en config cae a "claude" / "local": un ajuste mal guardado
// nunca debe impedir abrir la sesión.
// Google retiró Gemini CLI: un "gemini" guardado pasa a "antigravity" en vez de
// caer a "claude" sin avisar.
const LEGACY_CLIS = { gemini: "antigravity" };
const cliOf = (config) => {
  const cli = LEGACY_CLIS[config?.session_cli] || config?.session_cli;
  return CLIS[cli] ? cli : "claude";
};
const modeOf = (config) => (MODES.includes(config?.orchestration_mode) ? config.orchestration_mode : "local");

// Antigravity y Codex reciben las instrucciones como primer mensaje (-i o argumento)
// porque no tienen un flag para añadir al system prompt. Solo Claude recibe --settings
// con los hooks: sin ellos, Antigravity y Codex no
// avisan de cuándo terminan su turno y las tarjetas no se les pueden entregar solas.
function sessionCommand(cli, { remote = false } = {}) {
  if (cli === "antigravity") return 'agy -i "$DISPATCH_INSTRUCTIONS"';
  if (cli === "codex") return 'codex "$DISPATCH_INSTRUCTIONS"';
  const rc = remote ? ' --remote-control "$DISPATCH_RC_NAME"' : "";
  const awake = remote ? "/usr/bin/caffeinate -ims " : "";
  return `${awake}claude --append-system-prompt "$DISPATCH_INSTRUCTIONS" --settings "$DISPATCH_SETTINGS"${rc}`;
}

function planStep(cli) {
  return cli === "claude"
    ? "1) PLAN — Para tareas de más de un paso, entra en plan mode, lee lo necesario y\n   arma el plan indicando qué paso hace cada quien. Preséntamelo y espera mi\n   aprobación."
    : "1) PLAN — Para tareas de más de un paso, no cambies nada todavía: lee lo\n   necesario, arma el plan indicando qué paso hace cada quien, preséntamelo y\n   espera mi aprobación.";
}

function subagentsSection(port) {
  return `
## Subagentes
No hay agentes locales: delegas en tus propios subagentes (la herramienta de
subagentes de tu CLI). Cada subagente es un paso del plan con "agent":"subagente",
y el tablero tiene que reflejar lo que hacen:
- Al lanzarlo: curl -s -X POST http://localhost:${port}/api/plan/step/<id> \\
    -H "Content-Type: application/json" -d '{"column":"progress"}'
- Al terminar: {"column":"review","note":"<resumen de una línea>"}; si falló,
  {"column":"errors","note":"<motivo>"}.
- Varios subagentes independientes pueden ir en paralelo: mueve cada tarjeta.
- Pásale a cada subagente el contexto y la tarea acotada a una sola cosa, y revisa
  lo que devuelva antes de integrarlo.
- Nunca delegues decisiones de arquitectura ni la implementación de seguridad,
  auth o credenciales.
`;
}

function cardsSection(cli, port, project) {
  const delivery =
    cli === "claude"
      ? "Te llegan\nsolas al terminar tu turno, o escritas en la sesión si estás parado, con su id:"
      : `No te\nllegan solas: al terminar cada tarea, antes de reportarme, consulta
  curl -s http://localhost:${port}/api/plan
y mira las tarjetas con "manual": true. Según su columna:`;
  const notes =
    cli === "claude"
      ? "Al cerrar un plan te enseñaré mis notas pendientes del proyecto; pregúntame si\nsigo con alguna y no empieces ninguna sin mi respuesta."
      : `Al cerrar un plan, lee mis notas pendientes del proyecto:
  curl -s "http://localhost:${port}/api/notes?path=${project || "<ruta del repo>"}"
Pregúntame si sigo con alguna y no empieces ninguna sin mi respuesta.`;
  return `## Tarjetas del tablero y notas
Las tarjetas que escribo o muevo yo en el tablero son encargos para ti. ${delivery}
- En curso (progress): hazlas en cuanto termines lo que estabas haciendo.
- Por hacer (todo): propónmelas y pregúntame antes de empezar.
- Revisión (review): revisa lo que se hizo para esa tarea y repórtame.
- Errores (errors): algo falla; investiga y arréglalo.
- Hecho (done): nada, es mi registro.
Muévelas tú con POST /api/plan/step/<id> {"column":"..."} mientras las trabajas.
Cerrar el plan no las borra: siguen en el tablero hasta que las paso a hecho.
${notes}`;
}

module.exports = { CLIS, MODES, cliOf, modeOf, sessionCommand, planStep, subagentsSection, cardsSection };
