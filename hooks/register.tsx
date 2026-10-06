import { update } from 'claude-code'
import type { AgentInfo, EngineInterface as Engine, PluginOptions, Register, RenderElement, Timer } from 'claude-code'

import type { AgentEffort } from '../types'

// Alt+E steps the effort level up (low → medium → high → xhigh → max) and
// Alt+Shift+E down, each stopping at the end, for the agent in view: the main
// thread, or the subagent whose transcript the person opened from the tasks
// list. The footer shows that agent's model and level (`Opus 5.5 ▰▰▰▱▱ high`,
// a subagent's led by its type, the meter and word colored cool to hot, the
// blocks a press filled or emptied lit for a moment) the moment either changes,
// and a line under each Agent call shows the level of the agent it started.
// Steps run one at a time. A press past either end lights the word instead. At
// max the model name turns red too, and while Claude works a light sweeps across
// the bar. The keys step only through the levels /config's five include toggles
// allow, for every model.
//
// The footer's label is a stepper too: while the pointer is over it a `‹` shows
// before the meter and a `›` after the word (`Opus 5.5 ‹ ▰▰▰▱▱ high   ›`), and a
// click on either steps down or up exactly as the keys do, for the agent the
// footer shows. Each caret takes three cells, kept blank while it is hidden, and
// the word's slot is as wide as the widest level, so neither the label nor the
// carets move as they show or as the level changes, and quick clicks land on the
// same caret. A caret is a Client (./caret.tsx), drawn hidden in a Box placed
// over its cells that the label's hover reveals: the engine neither counts a
// Client's quick clicks as a double click nor selects anything under them, and
// each post carries the caret's running count of presses, so a post a frame
// replaced still steps. Nothing about a caret ever inverts.
//
// Each agent's level is its own. A subagent's starts as the engine resolved it
// (its definition's effort, else the parent's), read off its first model
// request, since neither `$.agent.list()` nor `agent.spawn` carries an effort;
// until then its meter is empty, and a press leaves it and says `wait`. Its
// model is known sooner, from the spawn, and shows beside the empty meter. A press
// while its transcript is in view sets the level its next requests go out with
// and leaves the main thread and every other agent as they were. Only the band
// above the prompt is told which transcript is in view (`view.agentId`), so the
// band records it for the footer to draw, and a press steps the agent recorded
// for the surface it came from: what that surface's footer shows. Each surface
// keeps its own: a session attached over Remote Control draws the band and the
// footer on the other surface too, showing its own transcript.
//
// A key reaches a mod without a prompt only through a Button naming an engine
// keybinding action, so keybindings.json binds meta+e to strip:jump9 and
// meta+shift+e to strip:jump8 (both idle at the prompt) and two hidden Buttons
// above the prompt take them, beside whatever other plugins draw there. No key with Shift as its only modifier can
// (Shift+Tab, Shift+Up): the engine hands a Button only chords and Ctrl or Alt
// keys, even with the mode switch unbound. A slash command leaves a transcript
// row. Claude Code's /effort prints rows too, so the mod never runs it: it sends
// each agent's level on that agent's model requests. The status line script reruns only
// on the engine's own changes, so model and level are drawn here, as a footer
// mode label, and not by ~/.claude/statusline.sh. Nothing tells a mod about an
// alt+p model pick, but the band above the prompt draws again once the picker
// closes, so the band notices the new model and records it, which redraws the
// label. Changing effort the engine's way (/effort, alt+p) drops the main
// thread's pick, and a subagent's when the engine's level for it changes too;
// alt+p's effort is seen at the next request.
//
// The tasks list draws no part a mod can, but its rows take a `subagentStatusLine`
// command's text, and a plugin may ship that setting: the plugin's settings.json names
// `[ -z "$EFFORT_CYCLE_ROWS" ] || exec python3 -I -S "$EFFORT_CYCLE_ROWS"`, which Claude
// Code applies beneath every settings file while the plugin is enabled. It substitutes no
// ${CLAUDE_PLUGIN_ROOT} there and runs the command in the session's folder with this
// process's environment, so the mod sets EFFORT_CYCLE_ROWS to its own
// subagent-rows/rows.py as the session starts (see pointRows). A subagentStatusLine in
// the person's own settings wins over the plugin's. While settings name one, either way,
// the mod leaves each subagent's model and
// level as the footer writes them, `Opus 5.5 ▰▰▰▱▱ high` in the footer's colors (no
// carets: nothing there takes a click), in
// ~/.claude/subagent-rows/sessions/<session id>/effort-cycle.json as
// `{ "order": 10, "agents": { "<agent id>": "<text>" } }`, for a command that joins
// every plugin's part of a row (subagent-rows/rows.py is one). It is written when an
// agent spawns, with its model and the footer's empty meter, `Opus 5.5 ▱▱▱▱▱ —`, and
// whenever a level changes. Claude Code runs the command every five seconds, and 300
// ms after its count of agents changes (so a spawn's row has its model from its first
// draw), so a row follows a press within five seconds. With /config's "Tasks list
// rows: update at once" on, each write of a changed level also nudges the terminal one
// column narrower and back 5 ms later (see nudgeRows): Claude Code reruns the command 300
// ms after the terminal's width changes too, so the row follows in about 0.4 s.
const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']

const override = { plugin: 'effort-cycle', key: 'override' } as const
const base = { plugin: 'effort-cycle', key: 'base' } as const
const agents = { plugin: 'effort-cycle', key: 'agents' } as const
const spawns = { plugin: 'effort-cycle', key: 'spawns' } as const
const viewed = { plugin: 'effort-cycle', key: 'viewedOn' } as const
const drawnModel = { plugin: 'effort-cycle', key: 'drawnModel' } as const
const flash = { plugin: 'effort-cycle', key: 'flash' } as const
const swept = { plugin: 'effort-cycle', key: 'swept' } as const
const listed = { plugin: 'effort-cycle', key: 'listed' } as const
const pressesSeen = { plugin: 'effort-cycle', key: 'pressesSeen' } as const

// The label's color per level, by theme key, so it follows the person's theme: cool to hot.
const HEAT: Record<string, string> = { low: 'inactive', medium: 'success', high: 'warning', xhigh: 'claude', max: 'error' }
const FLASH_MS = 1000
// The word's slot is as wide as the longest level, so the model and meter stay put as the level changes.
const WIDEST = Math.max(...LEVELS.map(l => l.length))
// The word while no request of a subagent's has said its level, and after a press on it.
const UNSEEN = '—'
const WAIT = 'wait'
// The sweep moves one block per step, as a terminal draws it, then rests: 5 steps of 85ms in each 1530ms.
const SWEEP_STEP_MS = 85
const SWEEP_STEPS = 18
// This plugin's place among the parts of a tasks list row. A row takes ANSI codes and not theme keys, so each theme key
// the label's colors use is written as the terminal's own color for it: gray, green, yellow, orange, red.
const ROW_ORDER = 10
const ANSI: Record<string, string> = { inactive: '90', success: '32', warning: '33', claude: '38;5;208', error: '31' }
// The cells each caret takes, all of which take its click: a blank, the caret, a blank.
const CARET_CELLS = 3
// A change written within this long of the last nudge rides on it: Claude Code reruns the command 300 ms after the
// width changed, which the nudge's child does some 10-20 ms after it starts, so the rerun reads the file well after
// such a write. A burst of presses makes one nudge (two repaints), not one each.
const NUDGE_RIDE_MS = 250
// The nudge's child, run by python3 isolated (-I: nothing from the environment, the user's site or the working
// directory) and without site (-S), started in a few milliseconds. On its controlling terminal, Claude Code's, it
// narrows the width by one column and restores it 5 ms later, the restore only while the width is still the one it
// set, so a resize the person made in between stands. The pause is for Claude Code to read the narrowed width: with
// none it missed it 3 times in 8, with 1 ms now and then while busy, with 5 ms not once in 35 (in tmux, fullscreen).
// Claude Code may paint a frame at the narrower width whatever the pause; it did most times in that test. The two
// steps run in a process of its own that nothing stopping the child reaches (a reload, an interrupt, a timeout):
// forked, in a process group of its own, its output closed, ignoring the signals a terminal sends; once it has
// narrowed, it restores. Without a terminal (a desktop or remote host, a headless run) it does nothing.
const NUDGE_SCRIPT = `
import fcntl, os, signal, struct, termios, time
for s in (signal.SIGHUP, signal.SIGINT, signal.SIGQUIT, signal.SIGTERM):
    signal.signal(s, signal.SIG_IGN)
try:
    fd = os.open('/dev/tty', os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
    def size():
        return struct.unpack('HHHH', fcntl.ioctl(fd, termios.TIOCGWINSZ, bytes(8)))
    def resize(rows, cols, x, y):
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, x, y))
    rows, cols, x, y = size()
except OSError:
    raise SystemExit(0)
if cols > 1 and os.fork() == 0:
    os.setpgid(0, 0)
    null = os.open(os.devnull, os.O_RDWR)
    for n in (0, 1, 2):
        os.dup2(null, n)
    narrowed = False
    try:
        resize(rows, cols - 1, x, y)
        narrowed = True
        time.sleep(0.005)
        narrowed = size()[:2] == (rows, cols - 1)
    except OSError:
        pass
    finally:
        if narrowed:
            resize(rows, cols, x, y)
        os._exit(0)
`

// Runs while Claude works; the band starts and stops it.
let sweeper: Timer | undefined
// When the last nudge started, by the session's clock; and whether one could not start (no python3), after which
// none is tried again until the plugin loads again. A reload starts both over.
let lastNudgeAt: number | undefined
let isNudgeBroken = false
// Whether EFFORT_CYCLE_ROWS names this load's script (see pointRows).
let isRowsPointed = false
// The surfaces where a caret's module failed: their footer draws no carets until the plugin loads again.
const caretsFailed = new Set<string>()

// What the footer draws for the agent in view: its model and level (null while unknown), a subagent's label.
type Shown = { model?: string; level: string | null; label?: string }
// The step a press made, as the flash state holds it.
type Flash = { id: number; from: number; to: number; agentId: string | null }
// A run of the label's text and its look, which the footer draws as a Text and a tasks list row writes in ANSI.
type Style = { color?: string; dimColor?: true; bold?: true }
type Run = { text: string; style: Style }

export const register: Register = (on, options) => {
  lastNudgeAt = undefined
  isNudgeBroken = false
  isRowsPointed = false

  // The plugin's own subagentStatusLine command runs the script EFFORT_CYCLE_ROWS names: this installed version's.
  on('session.start', async ($, e, next) => {
    await pointRows($)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) {
      const chosen = await agentStep($, options, e.agentId, e.model, e.effort)
      return yield* next(chosen === null ? e : { ...e, effort: chosen as typeof e.effort })
    }
    if (typeof e.effort !== 'string') return yield* next(e)
    const held = (await $.state.get(base)).value ?? null
    if (held?.model !== e.model || held.level !== e.effort) {
      // First request on this model, or the level changed the engine's way: follow the engine.
      if (held?.model === e.model) await $.state.set(override, null)
      await $.state.set(base, { model: e.model, level: e.effort })
    }
    const chosen = (await $.state.get(override)).value ?? null
    return yield* next(chosen?.model === e.model ? { ...e, effort: chosen.level as typeof e.effort } : e)
  })

  // Ties each Agent call to the agent it started, for the line under the call, and notes the model it runs on.
  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.agentId !== undefined) {
      await $.state.set({ ...spawns, id: e.tool_use_id }, started.agentId)
      await agentSpawned($, started.agentId, started.model)
    }
    return started
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const ran = await next(e)
    await $.state.set(override, null)
    const level = e.args.trim()
    if (LEVELS.includes(level)) await $.state.set(base, { model: await $.session.model(), level })
    return ran
  })

  on('command.run', { command: 'model' }, async ($, e, next) => {
    const ran = await next(e)
    await $.state.set(drawnModel, await $.session.model())
    return ran
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    await $.state.get(drawnModel)
    const agentId = (await $.state.get({ ...viewed, id: e.surface })).value ?? null
    const pressed = (await $.state.get(flash)).value ?? null
    const head = (await $.state.get(swept)).value ?? null
    const { model, level, label } = await shown($, agentId)
    const lit = litFor(pressed, agentId)
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    // The carets are Clients, which the terminal and the desktop draw (the two that draw this footer); a surface without
    // them, or where their module failed, gets the label alone.
    const Client = 'Client' in ui && !caretsFailed.has(e.surface) ? ui.Client : undefined
    const named: RenderElement[] = [
      ...(label === undefined ? [] : [<Text dimColor>{label} ·</Text>]),
      ...(model === undefined ? [] : [textOf(modelName(model, level))]),
    ]
    // A caret's cells, blank, and over them, hidden, the caret, which the label's hover reveals: the keyed Box below is
    // the hover's scope, and a Box placed `absolute` shows without moving anything. No Box between the two has a key,
    // which would make the caret's own cells its scope.
    const caret = (key: string, glyph: string, by: 1 | -1) =>
      Client === undefined ? undefined : (
        <Box flexShrink={0} width={CARET_CELLS} height={1}>
          <Text>{' '.repeat(CARET_CELLS)}</Text>
          <Box position="absolute" top={0} left={0} display="none" hover={{ display: 'flex' }}>
            <Client key={key} module="./caret.tsx" props={{ glyph, by }} width={CARET_CELLS} height={1} />
          </Box>
        </Box>
      )
    // The engine's own modes stay as it draws them, dim and joined by ` & `; the label follows: who, the model, the
    // down caret, the meter, the word in a slot as wide as the widest, the up caret.
    return (
      <Box>
        {e.props.modes.length > 0 && <Text dimColor>{e.props.modes.join(' & ')} & </Text>}
        <Box key="effort">
          {named.flatMap((part, i) => (i === 0 ? [part] : [' ', part]))}
          {caret('effort-down', '‹', -1) ?? (named.length > 0 && ' ')}
          {meter(level, lit, head).map(textOf)}
          {' '}
          {textOf(word(level, lit, WIDEST))}
          {caret('effort-up', '›', 1)}
        </Box>
      </Box>
    )
  })

  // A footer caret was clicked: as many steps of the agent the surface's footer shows as the caret's count of presses
  // moved since the last post heard from it, so a press whose post the frame replaced still steps. The keys' steps and
  // these run one at a time.
  on('ui.message', async ($, e, next) => {
    const pressed = caretPress(e.module, e.data)
    if (pressed !== undefined)
      await serially(async () => {
        const seen = { ...pressesSeen, id: pressed.caret }
        const before = (await $.state.get(seen)).value
        // A count below the last one heard is a new count (the caret's module loaded again): all of it is new.
        const steps = before === undefined || pressed.presses < before ? pressed.presses : pressed.presses - before
        await $.state.set(seen, pressed.presses)
        const agentId = (await $.state.get({ ...viewed, id: e.surface })).value ?? null
        // Past the end every press only lights the word again, so a few more than the levels show it as well as all.
        for (let i = 0; i < Math.min(steps, LEVELS.length); i++) await stepAgent($, options, pressed.by, agentId)
      })
    return next(e)
  })

  // A caret's module failed on a surface: once the engine draws the footer there again, it draws it without carets.
  on('ui.fault', async ($, e, next) => {
    if (e.component === 'SessionMode' && e.module.endsWith('caret.tsx')) caretsFailed.add(e.surface)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const model = await $.session.model()
    const agentId = e.props.view?.agentId ?? null
    const here = { ...viewed, id: e.surface }
    // A render may not write state, so the new model and the transcript in view are recorded just after.
    if (model !== (await $.state.get(drawnModel)).value) recordSoon($, () => $.state.set(drawnModel, model))
    if (agentId !== ((await $.state.get(here)).value ?? null)) recordSoon($, () => $.state.set(here, agentId))
    if (e.props.isWorking !== (sweeper !== undefined)) $.clock.after(0, () => sweep($, e.props.isWorking, e.surface))
    // The band is shared: what the plugins beneath and Claude Code's surveys draw there stays, the buttons hidden beside it.
    const below = await next(e)
    const { Box, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {below}
        <Box display="none">
          <Button key="effort-up" label="effort up" action="strip:jump9" onPress={press => step($, options, 1, press.surface)} />
          <Button key="effort-down" label="effort down" action="strip:jump8" onPress={press => step($, options, -1, press.surface)} />
        </Box>
      </Box>
    )
  })

  // Under an Agent call, the level of the agent it started, once a request of its has said it.
  on('ui.render', { component: 'ToolUse', props: { tool: 'Agent' } }, async ($, e, next) => {
    const drawn = await next(e)
    const agentId = (await $.state.get({ ...spawns, id: e.props.tool_use_id })).value
    const held = agentId === undefined ? undefined : (await $.state.get({ ...agents, id: agentId })).value
    const level = held === undefined ? null : agentLevel(held)
    if (held === undefined || level === null) return drawn
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {drawn}
        <Box key="effort" paddingLeft={2}>
          <Text dimColor>{displayName(held.model)} </Text>
          {meter(level).map(textOf)}
          <Text {...heat(level)}> {level}</Text>
        </Box>
      </Box>
    )
  })
}

// Records a subagent's request and answers the level the keys picked for it, null to send the engine's.
// Its first request seeds its level; a later one whose level the engine changed on the same model drops
// the pick, as on the main thread.
async function agentStep($: Engine, options: PluginOptions, agentId: string, model: string, effort: string | number | undefined): Promise<string | null> {
  const ref = { ...agents, id: agentId }
  const level = typeof effort === 'string' ? effort : null
  const held = (await $.state.get(ref)).value
  if (held !== undefined && held.model === model && held.base === level) return level === null ? null : held.override
  const label = held === undefined ? await labelFor($, agentId) : held.label
  const now = await update($, ref, current => {
    if (current === undefined) return { model, base: level, override: null, ...(label === undefined ? {} : { label }) }
    const isEngineChange = current.model === model && current.base !== null && current.base !== level
    return { ...current, model, base: level, override: isEngineChange ? null : current.override }
  })
  // The engine's own forks are no agent of the list, and have no row.
  if (now.label !== undefined) await listLevel($, options, agentId, agentLevel(now))
  return level === null ? null : now.override
}

// A subagent started, on the model its spawn resolved: the footer and its tasks list row show that model beside the
// empty meter until a request of its says its level. A request that came first has said both already, and the engine's
// own forks, no agent of the list, are left to their requests.
async function agentSpawned($: Engine, agentId: string, model: string) {
  const ref = { ...agents, id: agentId }
  if ((await $.state.get(ref)).value !== undefined) return
  const label = await labelFor($, agentId)
  if (label === undefined) return
  await update($, ref, current => current ?? { model, base: null, override: null, label })
  // Its row's part goes out at once, so the rerun Claude Code makes 300 ms after its count of agents changed draws the
  // model; that rerun comes anyway, so the spawn's write nudges nothing.
  const levels = await update($, listed, all => (all !== undefined && agentId in all ? all : { ...all, [agentId]: null }))
  await writeRows($, levels)
}

// Alt+E and Alt+Shift+E: a step of the agent the surface views.
async function step($: Engine, options: PluginOptions, by: 1 | -1, surface: string) {
  await serially(async () => stepAgent($, options, by, (await $.state.get({ ...viewed, id: surface })).value ?? null))
}

// Makes a write a render could not, once the render is over. A timer can fire while another site draws, which refuses
// the write too, so a refused one is tried again a little later, a few times.
const RECORD_TRIES = 10
const RECORD_RETRY_MS = 30
function recordSoon($: Engine, write: () => Promise<unknown>, tries = RECORD_TRIES) {
  $.clock.after(tries === RECORD_TRIES ? 0 : RECORD_RETRY_MS, async () => {
    try {
      await write()
    } catch {
      if (tries > 1) recordSoon($, write, tries - 1)
    }
  })
}

// Runs steps one after another: each reads the level the last one wrote, so two presses close together make two.
let queue: Promise<unknown> = Promise.resolve()
function serially<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work)
  queue = run.catch(() => undefined)
  return run
}

// The next allowed level above (or below) the agent's current one (null: the main thread); past the end the
// level stays and the word lights, and while a subagent's level is unknown the word says `wait`.
async function stepAgent($: Engine, options: PluginOptions, by: 1 | -1, agentId: string | null) {
  const allowed = LEVELS.filter(level => options[`include${level.charAt(0).toUpperCase()}${level.slice(1)}`] !== false)
  const above = (current: number) =>
    by > 0 ? allowed.find(l => LEVELS.indexOf(l) > current) : [...allowed].reverse().find(l => LEVELS.indexOf(l) < current)
  let current = -1
  let level: string | undefined
  if (agentId === null) {
    const model = await $.session.model()
    current = LEVELS.indexOf(await effortFor($, model))
    level = above(current)
    if (level) await $.state.set(override, { model, level })
  } else {
    const ref = { ...agents, id: agentId }
    const held = (await $.state.get(ref)).value
    const known = held === undefined ? null : agentLevel(held)
    if (held !== undefined && known !== null) {
      current = LEVELS.indexOf(known)
      const chosen = above(current)
      if (chosen) {
        await update($, ref, now => ({ ...(now ?? held), override: chosen }))
        await listLevel($, options, agentId, chosen)
      }
      level = chosen
    }
  }
  // The blocks the step crossed light for a moment; only the latest press's timer clears them.
  const id = ((await $.state.get(flash)).value?.id ?? 0) + 1
  await $.state.set(flash, { id, from: current, to: level ? LEVELS.indexOf(level) : current, agentId })
  $.clock.after(FLASH_MS, async () => {
    if ((await $.state.get(flash)).value?.id === id) await $.state.set(flash, null)
  })
}

// Leaves a subagent's level for its row in the tasks list (see the header), with the model it runs on. Every level is
// kept, so the first write once settings name a subagentStatusLine command has them all; a level that did not change
// writes nothing. With the nudge on, a write also nudges the terminal so the row follows at once, unawaited, so a step
// never waits on it.
async function listLevel($: Engine, options: PluginOptions, agentId: string, level: string | null) {
  if (level === null) return
  const before = (await $.state.get(listed)).value?.[agentId]
  if (before === level) return
  const levels = await update($, listed, all => ({ ...all, [agentId]: level }))
  if ((await writeRows($, levels)) && options.nudgeRows === true) void nudgeRows($)
}

// Writes every subagent's part of its row, while settings name a subagentStatusLine command (the plugin's own, from its
// settings.json, or the person's); true once written.
async function writeRows($: Engine, levels: Record<string, string | null>): Promise<boolean> {
  if ((await $.settings.read()).subagentStatusLine === undefined) return false
  // A plugin enabled after the session started may not have seen it start.
  if (!isRowsPointed) await pointRows($)
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  if (home === undefined) return false
  const parts: Record<string, string> = {}
  for (const [id, held] of Object.entries(levels)) parts[id] = rowPart((await $.state.get({ ...agents, id })).value?.model, held)
  const file = `${home}/.claude/subagent-rows/sessions/${await $.session.id()}/effort-cycle.json`
  await $.fs.write(file, JSON.stringify({ order: ROW_ORDER, agents: parts }))
  return true
}

// Points the plugin's subagentStatusLine command at this installed version's rows.py. The plugin's settings.json cannot
// name the script's path itself: Claude Code substitutes no ${CLAUDE_PLUGIN_ROOT} in a setting, runs the command in the
// session's folder, and gives it no CLAUDE_PLUGIN_ROOT, but it does give it this process's environment. The install's
// folder changes with each version, so the path is set on every load. Never rejects: unset, the command prints nothing
// and the rows stay Claude Code's own.
async function pointRows($: Engine): Promise<void> {
  const script = `${$.plugin.root}/subagent-rows/rows.py`
  try {
    if ((await $.env.get('EFFORT_CYCLE_ROWS')) !== script) await $.env.set('EFFORT_CYCLE_ROWS', script)
    isRowsPointed = true
  } catch {
    // Refused: tried again before the next write of the rows.
  }
}

// The width nudge, /config's "Tasks list rows: update at once": Claude Code reruns the subagentStatusLine command every
// five seconds, and 300 ms after the terminal's width changes, so a child on its terminal narrows it one column and
// restores it 5 ms later (NUDGE_SCRIPT), and the rows follow a press in about 0.4 s. It costs two repaints, and usually a
// frame drawn one column narrower shows for a moment. A change within NUDGE_RIDE_MS of the last nudge rides on it. Only
// while a terminal draws the session; never rejects, whatever the host has or lacks.
async function nudgeRows($: Engine): Promise<void> {
  if (isNudgeBroken) return
  try {
    const now = await $.clock.now()
    if (lastNudgeAt !== undefined && now - lastNudgeAt < NUDGE_RIDE_MS) return
    lastNudgeAt = now
    if (!(await $.session.surfaces()).includes('terminal')) return
    await $.process.run(['python3', '-I', '-S', '-c', NUDGE_SCRIPT], { cwd: $.plugin.root, timeoutMs: 5000 })
  } catch {
    // No python3, or no way to start it: the rows follow at Claude Code's own pace from now on.
    isNudgeBroken = true
  }
}

// A subagent's part of its tasks list row: its model, meter and level as the footer writes them, in the footer's colors
// as ANSI, `Opus 5.5 ▰▰▰▱▱ high`, with no carets, padding or flash; the footer's empty meter, `▱▱▱▱▱ —`, while no
// request of its has said its level.
function rowPart(model: string | undefined, level: string | null): string {
  const named = model === undefined ? [] : [modelName(model, level), plain(' ')]
  return ansi([...named, ...meter(level), plain(' '), word(level)])
}

// Runs as ANSI text: each run's color and weight, a run alike to the one before joined to it.
function ansi(runs: Run[]): string {
  const joined: { text: string; codes: [string, string] }[] = []
  for (const run of runs) {
    const codes = ansiCodes(run.style)
    const last = joined.at(-1)
    if (last !== undefined && last.codes[0] === codes[0]) last.text += run.text
    else joined.push({ text: run.text, codes })
  }
  return joined.map(({ text, codes: [on, off] }) => (on === '' ? text : `\x1b[${on}m${text}\x1b[${off}m`)).join('')
}

// A look's ANSI codes: those that turn it on, and those that turn just that off again, so nothing around it changes.
function ansiCodes(style: Style): [string, string] {
  const on: string[] = []
  const off: string[] = []
  if (style.bold) on.push('1')
  if (style.dimColor) on.push('2')
  if (style.bold || style.dimColor) off.push('22')
  if (style.color !== undefined) {
    on.push(ANSI[style.color] ?? '39')
    off.push('39')
  }
  return [on.join(';'), off.join(';')]
}

// What a footer caret posted, read back: which caret, its running count of presses and which way; undefined for
// anything else.
function caretPress(module: string, data: unknown): { caret: string; presses: number; by: 1 | -1 } | undefined {
  if (!module.endsWith('caret.tsx') || typeof data !== 'object' || data === null) return undefined
  const { caret, presses, by } = data as { caret?: unknown; presses?: unknown; by?: unknown }
  if (typeof caret !== 'string' || typeof presses !== 'number' || !Number.isInteger(presses) || presses < 0) return undefined
  if (by !== 1 && by !== -1) return undefined
  return { caret, presses, by }
}

// While Claude works, steps the sweep's head along the bar at max; otherwise stops it and clears the head.
function sweep($: Engine, working: boolean, surface: string) {
  if (working === (sweeper !== undefined)) return
  sweeper?.cancel()
  sweeper = undefined
  if (!working) return void $.state.set(swept, null)
  let tick = 0
  sweeper = $.clock.every(SWEEP_STEP_MS, async () => {
    const at = tick++ % SWEEP_STEPS
    // The head moves over the blocks and leaves; nothing changes while it rests.
    if (at > LEVELS.length) return
    const onMax = (await shown($, (await $.state.get({ ...viewed, id: surface })).value ?? null)).level === 'max'
    const head = onMax && at < LEVELS.length ? at : null
    if ((await $.state.get(swept)).value !== head) await $.state.set(swept, head)
  })
}

// The agent in view's model and level: the main thread's, or a subagent's as its requests and the keys left it.
async function shown($: Engine, agentId: string | null): Promise<Shown> {
  if (agentId === null) {
    const model = await $.session.model()
    return { model, level: await effortFor($, model) }
  }
  const held = (await $.state.get({ ...agents, id: agentId })).value
  const label = held === undefined ? await labelFor($, agentId) : held.label
  return { ...(held === undefined ? {} : { model: held.model }), level: held === undefined ? null : agentLevel(held), ...(label === undefined ? {} : { label }) }
}

// A subagent's level: the keys' pick, else the engine's; null while no request of its has said it.
function agentLevel(held: AgentEffort): string | null {
  return held.override ?? held.base
}

// What the footer calls a subagent: its agent type, a teammate spawned as none by its name; undefined for a loop the session
// lists no agent for (the engine's own forks).
async function labelFor($: Engine, agentId: string): Promise<string | undefined> {
  try {
    const info = (await $.agent.list()).find(agent => agent.id === agentId)
    return info === undefined ? undefined : labelOf(info)
  } catch {
    return undefined
  }
}

function labelOf(info: AgentInfo): string {
  return info.type === 'teammate' && info.name !== undefined ? info.name : info.type
}

// The latest press, when it stepped this agent (null: the main thread): what lights its meter.
function litFor(pressed: Flash | null, agentId: string | null): Flash | null {
  return pressed !== null && (pressed.agentId ?? null) === agentId ? pressed : null
}

// The model's name as the footer and a tasks list row write it: dim, and at max in max's color.
function modelName(model: string, level: string | null): Run {
  return { text: displayName(model), style: level === 'max' ? heat(level) : { dimColor: true } }
}

// The five blocks of a level's meter, filled up to the level in its color; the blocks a press just filled or
// emptied bright, and at max the sweep's head.
function meter(level: string | null, lit: Flash | null = null, head: number | null = null): Run[] {
  const filled = level === null ? 0 : LEVELS.indexOf(level) + 1
  return LEVELS.map((_, i): Run => {
    const full = i < filled
    const changed = lit !== null && i > Math.min(lit.from, lit.to) && i <= Math.max(lit.from, lit.to)
    if (changed) return { text: full ? '▰' : '▱', style: { color: 'text', bold: true } }
    if (i === head && level === 'max') return { text: '▰', style: { color: 'text' } }
    return { text: full ? '▰' : '▱', style: full ? heat(level) : { dimColor: true } }
  })
}

// The level's word after the meter, in its color and bold at max: lit by a press past either end, `wait` after a
// press on a subagent whose level is unknown, `—` until then. The footer pads it as wide as the widest.
function word(level: string | null, lit: Flash | null = null, width = 0): Run {
  const atEnd = lit !== null && lit.from === lit.to
  const style: Style = atEnd ? { color: 'text', bold: true } : level === 'max' ? { ...heat(level), bold: true } : heat(level)
  return { text: (level ?? (atEnd ? WAIT : UNSEEN)).padEnd(width), style }
}

// A level's color, by theme key; dim while it is unknown.
function heat(level: string | null): Style {
  const color = level === null ? undefined : HEAT[level]
  return color === undefined ? { dimColor: true } : { color }
}

// A run as the footer draws it: a Text every surface draws.
function textOf(run: Run): RenderElement {
  const props: Record<string, string | boolean> = {}
  if (run.style.color !== undefined) props.color = run.style.color
  if (run.style.dimColor) props.dimColor = true
  if (run.style.bold) props.bold = true
  return { type: 'Text', props, children: [run.text] }
}

function plain(text: string): Run {
  return { text, style: {} }
}

// The level the main thread's next request goes out with: Alt+E's or Alt+Shift+E's, else the engine's
// (its last request's, or before any the model's saved default).
async function effortFor($: Engine, model: string): Promise<string> {
  const chosen = (await $.state.get(override)).value
  if (chosen?.model === model) return chosen.level
  const held = (await $.state.get(base)).value
  if (held?.model === model) return held.level
  // Settings are the person's own JSON, typed unknown: a level is a string, anything else none.
  const settings = await $.settings.read()
  const perModel = settings.modelSettings as { readonly [model: string]: { readonly effortLevel?: unknown } | undefined } | undefined
  return levelOf(perModel?.[model]?.effortLevel) ?? levelOf(settings.effortLevel) ?? 'high'
}

function levelOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

// claude-opus-5-5 → Opus 5.5, claude-haiku-4-5-20251001 → Haiku 4.5, …[1m] → … 1M.
function displayName(model: string): string {
  const long = model.endsWith('[1m]')
  const [family, ...version] = model.replace('[1m]', '').replace(/^claude-/, '').split('-').filter(p => !/^\d{8}$/.test(p))
  if (!family) return model
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${version.join('.')}`.trim() + (long ? ' 1M' : '')
}
