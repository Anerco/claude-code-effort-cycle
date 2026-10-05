import type { EngineInterface as Engine, PluginOptions, Register, Timer } from 'claude-code'

// Alt+E steps the effort level up (low → medium → high → xhigh → max) and
// Alt+Shift+E down, each stopping at the end, and the footer shows the model and
// level (`Opus 5.5 ▰▰▰▱▱ high`, the meter and word colored cool to hot, the
// blocks a press filled or emptied lit for a moment) the moment either changes.
// A press past either end lights the word instead. At max the model name turns
// red too, and while Claude works a light sweeps across the bar. The keys step only
// through the levels /config's five include toggles allow, for every model.
//
// A key reaches a mod without a prompt only through a Button naming an engine
// keybinding action, so keybindings.json binds meta+e to strip:jump9 and
// meta+shift+e to strip:jump8 (both idle at the prompt) and two hidden Buttons
// above the prompt take them, beside whatever other plugins draw there. No key with Shift as its only modifier can
// (Shift+Tab, Shift+Up): the engine hands a Button only chords and Ctrl or Alt
// keys, even with the mode switch unbound. A slash command leaves a transcript
// row. Claude Code's /effort prints rows too, so the mod never runs it: it sends
// its level on each main-loop model request. The status line script reruns only
// on the engine's own changes, so model and level are drawn here, as a footer
// mode label, and not by ~/.claude/statusline.sh. Nothing tells a mod about an
// alt+p model pick, but the band above the prompt draws again once the picker
// closes, so the band notices the new model and records it, which redraws the
// label. Changing effort the engine's way (/effort, alt+p) drops the override;
// alt+p's effort is seen at the next request.
const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']

const override = { plugin: 'effort-cycle', key: 'override' } as const
const base = { plugin: 'effort-cycle', key: 'base' } as const
const drawnModel = { plugin: 'effort-cycle', key: 'drawnModel' } as const
const flash = { plugin: 'effort-cycle', key: 'flash' } as const
const swept = { plugin: 'effort-cycle', key: 'swept' } as const

// The label's color per level, by theme key, so it follows the person's theme: cool to hot.
const HEAT: Record<string, string> = { low: 'inactive', medium: 'success', high: 'warning', xhigh: 'claude', max: 'error' }
const FLASH_MS = 1000
// The word's slot is as wide as the longest level, so the model and meter stay put as the level changes.
const WIDEST = Math.max(...LEVELS.map(l => l.length))
// The sweep moves one block per step, as a terminal draws it, then rests: 5 steps of 85ms in each 1530ms.
const SWEEP_STEP_MS = 85
const SWEEP_STEPS = 18

// Runs while Claude works; the band starts and stops it.
let sweeper: Timer | undefined

export const register: Register = (on, options) => {
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined || typeof e.effort !== 'string') return yield* next(e)
    const held = (await $.state.get(base)).value ?? null
    if (held?.model !== e.model || held.level !== e.effort) {
      // First request on this model, or the level changed the engine's way: follow the engine.
      if (held?.model === e.model) await $.state.set(override, null)
      await $.state.set(base, { model: e.model, level: e.effort })
    }
    const chosen = (await $.state.get(override)).value ?? null
    return yield* next(chosen?.model === e.model ? { ...e, effort: chosen.level as typeof e.effort } : e)
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

  on('ui.render', { component: 'SessionMode' }, async ($, e) => {
    await $.state.get(drawnModel)
    const lit = (await $.state.get(flash)).value ?? null
    const head = (await $.state.get(swept)).value ?? null
    // A press past either end left the level where it was.
    const atEnd = lit !== null && lit.from === lit.to
    const model = await $.session.model()
    const level = await effortFor($, model)
    const filled = LEVELS.indexOf(level) + 1
    const color = HEAT[level]
    const { Box, Text } = $.ui.resolve(e)
    // The engine's own modes stay as it draws them, dim and joined by ` & `; the label follows.
    return (
      <Box>
        {e.props.modes.length > 0 && <Text dimColor>{e.props.modes.join(' & ')} & </Text>}
        <Box key="effort">
          {level === 'max' ? <Text color={color}>{displayName(model)} </Text> : <Text dimColor>{displayName(model)} </Text>}
          {LEVELS.map((_, i) => {
            const full = i < filled
            // A block the last press filled or emptied, between the level it left and the one it reached.
            const changed = lit !== null && i > Math.min(lit.from, lit.to) && i <= Math.max(lit.from, lit.to)
            if (changed) return <Text color="text" bold>{full ? '▰' : '▱'}</Text>
            if (i === head && level === 'max') return <Text color="text">▰</Text>
            return full ? <Text color={color}>▰</Text> : <Text dimColor>▱</Text>
          })}
          <Text color={atEnd ? 'text' : color} bold={atEnd || level === 'max'}> {level.padEnd(WIDEST)}</Text>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const model = await $.session.model()
    // A render may not write state, so the new model is recorded just after.
    if (model !== (await $.state.get(drawnModel)).value) $.clock.after(0, () => void $.state.set(drawnModel, model))
    if (e.props.isWorking !== (sweeper !== undefined)) $.clock.after(0, () => sweep($, e.props.isWorking))
    // The band is shared: what the plugins beneath and Claude Code's surveys draw there stays, the buttons hidden beside it.
    const below = await next(e)
    const { Box, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {below}
        <Box display="none">
          <Button key="effort-up" label="effort up" action="strip:jump9" onPress={() => step($, options, 1)} />
          <Button key="effort-down" label="effort down" action="strip:jump8" onPress={() => step($, options, -1)} />
        </Box>
      </Box>
    )
  })
}

// The next allowed level above (or below) the current one; past the end the level stays and the word lights.
async function step($: Engine, options: PluginOptions, by: 1 | -1) {
  const model = await $.session.model()
  const current = LEVELS.indexOf(await effortFor($, model))
  const allowed = LEVELS.filter(level => options[`include${level.charAt(0).toUpperCase()}${level.slice(1)}`] !== false)
  const level = by > 0 ? allowed.find(l => LEVELS.indexOf(l) > current) : [...allowed].reverse().find(l => LEVELS.indexOf(l) < current)
  if (level) await $.state.set(override, { model, level })
  // The blocks the step crossed light for a moment; only the latest press's timer clears them.
  const id = ((await $.state.get(flash)).value?.id ?? 0) + 1
  await $.state.set(flash, { id, from: current, to: level ? LEVELS.indexOf(level) : current })
  $.clock.after(FLASH_MS, async () => {
    if ((await $.state.get(flash)).value?.id === id) await $.state.set(flash, null)
  })
}

// While Claude works, steps the sweep's head along the bar at max; otherwise stops it and clears the head.
function sweep($: Engine, working: boolean) {
  if (working === (sweeper !== undefined)) return
  sweeper?.cancel()
  sweeper = undefined
  if (!working) return void $.state.set(swept, null)
  let tick = 0
  sweeper = $.clock.every(SWEEP_STEP_MS, async () => {
    const at = tick++ % SWEEP_STEPS
    // The head moves over the blocks and leaves; nothing changes while it rests.
    if (at > LEVELS.length) return
    const onMax = (await effortFor($, await $.session.model())) === 'max'
    const head = onMax && at < LEVELS.length ? at : null
    if ((await $.state.get(swept)).value !== head) await $.state.set(swept, head)
  })
}

// The level the model's next request goes out with: Alt+E's or Alt+Shift+E's, else the engine's
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
