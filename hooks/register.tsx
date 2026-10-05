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
// Each agent's level is its own. A subagent's starts as the engine resolved it
// (its definition's effort, else the parent's), read off its first model
// request, since neither `$.agent.list()` nor `agent.spawn` carries an effort;
// until then its meter is empty, and a press leaves it and says `wait`. A press
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
const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']

const override = { plugin: 'effort-cycle', key: 'override' } as const
const base = { plugin: 'effort-cycle', key: 'base' } as const
const agents = { plugin: 'effort-cycle', key: 'agents' } as const
const spawns = { plugin: 'effort-cycle', key: 'spawns' } as const
const viewed = { plugin: 'effort-cycle', key: 'viewedOn' } as const
const drawnModel = { plugin: 'effort-cycle', key: 'drawnModel' } as const
const flash = { plugin: 'effort-cycle', key: 'flash' } as const
const swept = { plugin: 'effort-cycle', key: 'swept' } as const

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

// Runs while Claude works; the band starts and stops it.
let sweeper: Timer | undefined

// What the footer draws for the agent in view: its model and level (null while unknown), a subagent's label.
type Shown = { model?: string; level: string | null; label?: string }
// The step a press made, as the flash state holds it.
type Flash = { id: number; from: number; to: number; agentId: string | null }

export const register: Register = (on, options) => {
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) {
      const chosen = await agentStep($, e.agentId, e.model, e.effort)
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

  // Ties each Agent call to the agent it started, for the line under the call.
  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.agentId !== undefined) await $.state.set({ ...spawns, id: e.tool_use_id }, started.agentId)
    return started
  })

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
    const color = level === null ? undefined : HEAT[level]
    const name = model === undefined ? undefined : displayName(model)
    const { Box, Text } = $.ui.resolve(e)
    // The engine's own modes stay as it draws them, dim and joined by ` & `; the label follows.
    return (
      <Box>
        {e.props.modes.length > 0 && <Text dimColor>{e.props.modes.join(' & ')} & </Text>}
        <Box key="effort">
          {label !== undefined && <Text dimColor>{label} · </Text>}
          {name !== undefined && (level === 'max' ? <Text color={color}>{name} </Text> : <Text dimColor>{name} </Text>)}
          {meter(level, lit, head)}
          {word(level, lit)}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const model = await $.session.model()
    const agentId = e.props.view?.agentId ?? null
    const here = { ...viewed, id: e.surface }
    // A render may not write state, so the new model and the transcript in view are recorded just after.
    if (model !== (await $.state.get(drawnModel)).value) $.clock.after(0, () => void $.state.set(drawnModel, model))
    if (agentId !== ((await $.state.get(here)).value ?? null)) $.clock.after(0, () => void $.state.set(here, agentId))
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
          {meter(level)}
          <Text {...heat(level)}> {level}</Text>
        </Box>
      </Box>
    )
  })
}

// Records a subagent's request and answers the level the keys picked for it, null to send the engine's.
// Its first request seeds its level; a later one whose level the engine changed on the same model drops
// the pick, as on the main thread.
async function agentStep($: Engine, agentId: string, model: string, effort: string | number | undefined): Promise<string | null> {
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
  return level === null ? null : now.override
}

// Alt+E and Alt+Shift+E: a step of the agent the surface views.
async function step($: Engine, options: PluginOptions, by: 1 | -1, surface: string) {
  await serially(async () => stepAgent($, options, by, (await $.state.get({ ...viewed, id: surface })).value ?? null))
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
      if (chosen) await update($, ref, now => ({ ...(now ?? held), override: chosen }))
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

// The five blocks of a level's meter, filled up to the level in its color; the blocks a press just filled or
// emptied bright, and at max the sweep's head. Plain elements every surface draws.
function meter(level: string | null, lit: Flash | null = null, head: number | null = null): RenderElement[] {
  const filled = level === null ? 0 : LEVELS.indexOf(level) + 1
  return LEVELS.map((_, i) => {
    const full = i < filled
    const changed = lit !== null && i > Math.min(lit.from, lit.to) && i <= Math.max(lit.from, lit.to)
    if (changed) return { type: 'Text', props: { color: 'text', bold: true }, children: [full ? '▰' : '▱'] }
    if (i === head && level === 'max') return { type: 'Text', props: { color: 'text' }, children: ['▰'] }
    return { type: 'Text', props: full ? heat(level) : { dimColor: true }, children: [full ? '▰' : '▱'] }
  })
}

// The level's word after the meter, as wide as the widest: lit by a press past either end, `wait` after a press
// on a subagent whose level is unknown, `—` until then.
function word(level: string | null, lit: Flash | null): RenderElement {
  const atEnd = lit !== null && lit.from === lit.to
  const style: Record<string, string | boolean> = atEnd ? { color: 'text', bold: true } : level === null ? { dimColor: true } : { ...heat(level), bold: level === 'max' }
  return { type: 'Text', props: style, children: [` ${(level ?? (atEnd ? WAIT : UNSEEN)).padEnd(WIDEST)}`] }
}

// A level's color, by theme key; dim while it is unknown.
function heat(level: string | null): { color: string } | { dimColor: true } {
  const color = level === null ? undefined : HEAT[level]
  return color === undefined ? { dimColor: true } : { color }
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
