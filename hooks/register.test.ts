import { test, expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { AgentInfo, On, RenderElement, RenderPropsOf } from 'claude-code'

// Claude Code's own band, beneath every plugin: empty here, as with no survey up.
const engineBand = (on: On) => on('ui.render', { component: 'AbovePrompt' }, (): RenderElement => ({ type: 'Box', children: [] }))
// Claude Code's own footer modes, beneath the plugin: what shows when the plugin draws no meter there.
const engineModes = (on: On) => on('ui.render', { component: 'SessionMode' }, (): RenderElement => ({ type: 'Box', props: { key: 'engine-modes' }, children: [] }))
const BAND: RenderPropsOf['AbovePrompt'] = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 19 }, view: {} }
const agent = (id: string, type: string, description = 'a task'): AgentInfo => ({ id, description, type, status: 'running' })
// The footer's label as read in the tests, its cells kept for the hidden carets closed up to one space: `Opus 5.5 ▰▰▰▱▱ high`.
const spaced = (text: string | undefined) => text?.replace(/ +/g, ' ').trim()

// A session on Opus 5.5 at high with two subagents, an Explore and a general-purpose; `sent` holds each
// request's agent and effort as it left the plugin, and `view` opens a transcript as the tasks list does.
async function world($: Engine, on: On, settings: Record<string, unknown> = { effortLevel: 'high' }, surface: 'terminal' | 'desktop' = 'terminal') {
  engineBand(on)
  engineModes(on)
  const clock = mock.clock(on)
  on('settings.read', () => ({ value: settings }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  const listed = [agent('a1', 'Explore', 'Find the config'), agent('a2', 'general-purpose', 'Fix the parser')]
  on('agent.list', () => ({ value: listed }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const sent: string[] = []
  on('turn.step', async function* (_, e) {
    sent.push(`${e.agentId ?? 'main'}:${e.effort}`)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: null }
  })
  const request = async (effort: string, agentId?: string, model = 'claude-opus-5-5') => {
    const stream = $.turn.step({ turnId: 't', index: 0, model, effort, messageCount: 1, ...(agentId && { agentId }) } as any)
    for await (const _ of stream);
  }
  const band = await $.ui.mount({ plugin: 'effort-cycle', surface, component: 'AbovePrompt', props: BAND })
  const label = await $.ui.mount({ plugin: 'effort-cycle', surface, component: 'SessionMode', props: { modes: [] } })
  await clock.settle()
  const footer = async () => spaced((await label.find({ key: 'effort' }))?.text)
  const view = async (agentId?: string) => {
    await band.redraw({ ...BAND, view: agentId === undefined ? {} : { agentId } })
    await clock.settle()
  }
  // Alt+E and Alt+Shift+E, as the person's keybindings.json binds them to strip:jump9 and strip:jump8.
  const up = () => band.press({ key: 'effort-up' })
  const down = () => band.press({ key: 'effort-down' })
  // Alt+↑ and Alt+↓ (Ctrl+↑ and Ctrl+↓), Claude Code's own keys for the diff panel's file list, bound with no setup.
  const upArrow = () => band.press({ key: 'effort-up-arrow' })
  const downArrow = () => band.press({ key: 'effort-down-arrow' })
  // A click on a footer caret as the surface reports it, on one of its three cells: the left button down, then up.
  const click = async (caret: 'effort-down' | 'effort-up', x = 1) => {
    await label.pointer({ type: 'down', x, y: 0, button: 'left', in: caret })
    await label.pointer({ type: 'up', x, y: 0, button: 'left', in: caret })
  }
  return { clock, band, label, listed, sent, request, footer, view, up, down, upArrow, downArrow, click }
}

test('Alt+E steps the level up and Alt+Shift+E down, stopping at the ends, the footer shows model and level, main-loop requests carry it, the engine taking over drops it', async ($, on) => {
  engineBand(on)
  on('settings.read', () => ({ value: { modelSettings: { 'claude-opus-5-5': { effortLevel: 'high' } } } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  const sent: unknown[] = []
  on('turn.step', async function* (_, e) {
    sent.push(e.agentId ? `agent:${e.effort}` : e.effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: null }
  })
  const step = async (effort: string, agentId?: string) => {
    const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', effort, messageCount: 1, ...(agentId && { agentId }) } as any)
    for await (const _ of stream);
  }
  const band = await $.ui.mount({
    plugin: 'effort-cycle', surface: 'terminal', component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120 } as any,
  })
  const label = await $.ui.mount({ plugin: 'effort-cycle', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  const footer = async () => spaced((await label.find({ key: 'effort' }))?.text)
  const press = () => band.press({ key: 'effort-up' })
  const pressDown = () => band.press({ key: 'effort-down' })

  expect(await footer()).toBe('Opus 5.5 ▰▰▰▱▱ high')
  await press()
  await press()
  expect(await footer()).toContain('▰ max')
  // Up stops at max; down steps back, and max is one press away again.
  await press()
  expect(await footer()).toContain('▰ max')
  await pressDown()
  expect(await footer()).toContain('▱ xhigh')
  await press()
  await step('high')
  await step('high', 'a1')
  // The person picks low with alt+p: the engine's level changes and wins.
  await step('low')
  expect(sent).toEqual(['max', 'agent:high', 'low'])
  expect(await footer()).toContain('▱ low')
  // Down stops at low; up leaves it.
  await pressDown()
  expect(await footer()).toContain('▱ low')
  await press()
  expect(await footer()).toContain('▱ medium')
})

test('the keys step only through the levels the include toggles allow', { options: { includeLow: false, includeMax: false } }, async ($, on) => {
  engineBand(on)
  on('settings.read', () => ({ value: { effortLevel: 'medium' } }))
  on('session.model', () => ({ value: 'claude-sonnet-5' }))
  const band = await $.ui.mount({
    plugin: 'effort-cycle', surface: 'terminal', component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120 } as any,
  })
  const label = await $.ui.mount({ plugin: 'effort-cycle', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  const footer = async () => spaced((await label.find({ key: 'effort' }))?.text)
  const up = () => band.press({ key: 'effort-up' })
  const down = () => band.press({ key: 'effort-down' })

  // Low and max are off: from medium, up stops at xhigh and down at medium.
  await up()
  await up()
  await up()
  expect(await footer()).toContain('▱ xhigh')
  await down()
  await down()
  await down()
  expect(await footer()).toContain('▱ medium')
})

test('a press lights the blocks it filled or emptied for a moment, the engine\'s own modes stay beside the label', async ($, on) => {
  engineBand(on)
  const clock = mock.clock(on)
  on('settings.read', () => ({ value: { effortLevel: 'high' } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  const band = await $.ui.mount({
    plugin: 'effort-cycle', surface: 'terminal', component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120 } as any,
  })
  const label = await $.ui.mount({ plugin: 'effort-cycle', surface: 'terminal', component: 'SessionMode', props: { modes: ['focus'] } })
  const blocks = async () => (await label.findAll({ type: 'Text', text: /^[▰▱]$/ })).map(b => b.text + (b.props.color ?? 'dim'))
  const width = async () => (await label.find({ key: 'effort' }))?.text.length
  const rest = await width()

  expect(await label.find({ type: 'Text', text: 'focus &' })).toBeDefined()
  expect(await blocks()).toEqual(['▰warning', '▰warning', '▰warning', '▱dim', '▱dim'])
  await band.press({ key: 'effort-up' })
  expect(await blocks()).toEqual(['▰claude', '▰claude', '▰claude', '▰text', '▱dim'])
  // xhigh is longer than high, and the label keeps its width.
  expect(await width()).toBe(rest)
  await clock.advance(600)
  await band.press({ key: 'effort-down' })
  // The first press's timer passes; the second's still lights the block it emptied.
  await clock.advance(600)
  expect(await blocks()).toEqual(['▰warning', '▰warning', '▰warning', '▱text', '▱dim'])
  await clock.advance(600)
  expect(await blocks()).toEqual(['▰warning', '▰warning', '▰warning', '▱dim', '▱dim'])
})

test('at max the model name turns red, and a press past either end lights the word and leaves the meter', async ($, on) => {
  engineBand(on)
  const clock = mock.clock(on)
  on('settings.read', () => ({ value: { effortLevel: 'xhigh' } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  const band = await $.ui.mount({
    plugin: 'effort-cycle', surface: 'terminal', component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120 } as any,
  })
  const label = await $.ui.mount({ plugin: 'effort-cycle', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  const name = () => label.find({ type: 'Text', text: 'Opus 5.5' })
  const word = () => label.find({ type: 'Text', text: /^[a-z]+ *$/ })
  const blocks = async () => (await label.findAll({ type: 'Text', text: /^[▰▱]$/ })).map(b => b.text + (b.props.color ?? 'dim'))

  expect((await name())?.props).toMatchObject({ dimColor: true })
  await band.press({ key: 'effort-up' })
  await clock.advance(1000)
  expect((await word())?.text.trim()).toBe('max')
  expect((await word())?.props).toMatchObject({ color: 'error', bold: true })
  expect((await name())?.props).toMatchObject({ color: 'error' })
  await band.press({ key: 'effort-up' })
  expect((await word())?.props).toMatchObject({ color: 'text', bold: true })
  expect(await blocks()).toEqual(Array(5).fill('▰error'))
  await clock.advance(1000)
  expect((await word())?.props).toMatchObject({ color: 'error' })
})

test('at max a light sweeps the bar while Claude works, and stops when it is done', async ($, on) => {
  engineBand(on)
  const clock = mock.clock(on)
  on('settings.read', () => ({ value: { effortLevel: 'max' } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  const props = { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 120 } as any
  const band = await $.ui.mount({ plugin: 'effort-cycle', surface: 'terminal', component: 'AbovePrompt', props })
  const label = await $.ui.mount({ plugin: 'effort-cycle', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  const lit = async () => (await label.findAll({ type: 'Text', text: /^[▰▱]$/ })).findIndex(b => b.props.color === 'text')

  await clock.settle()
  const heads: number[] = []
  for (let i = 0; i < 18; i++) {
    await clock.advance(85)
    heads.push(await lit())
  }
  // Five steps across the bar, then a rest with nothing lit, over and over.
  expect(heads).toEqual([0, 1, 2, 3, 4, ...Array(13).fill(-1)])
  await clock.advance(85 * 2)
  expect(await lit()).toBe(1)
  await band.redraw({ ...props, isWorking: false })
  await clock.settle()
  expect(await lit()).toBe(-1)
  await clock.advance(85 * 18)
  expect(await lit()).toBe(-1)
})

test('the band keeps what the plugins beneath draw there, and the keys still step', {
  plugins: [{
    name: 'other-band',
    register(on) {
      on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', props: { key: 'other' }, children: [{ type: 'Text', children: ['theirs'] }] }))
    },
  }],
}, async ($, on) => {
  on('settings.read', () => ({ value: { effortLevel: 'high' } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  const band = await $.ui.mount({
    plugin: 'effort-cycle', surface: 'terminal', component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120 } as any,
  })
  const label = await $.ui.mount({ plugin: 'effort-cycle', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  const footer = async () => spaced((await label.find({ key: 'effort' }))?.text)
  const theirs = async () => (await band.find({ key: 'other' }))?.text

  expect(await theirs()).toBe('theirs')
  await band.press({ key: 'effort-up' })
  expect(await footer()).toBe('Opus 5.5 ▰▰▰▰▱ xhigh')
  await band.press({ key: 'effort-down' })
  await band.press({ key: 'effort-down' })
  expect(await footer()).toBe('Opus 5.5 ▰▰▱▱▱ medium')
  await band.press({ key: 'effort-up-arrow' })
  expect(await footer()).toBe('Opus 5.5 ▰▰▰▱▱ high')
  await band.press({ key: 'effort-down-arrow' })
  expect(await footer()).toBe('Opus 5.5 ▰▰▱▱▱ medium')
  expect(await theirs()).toBe('theirs')
})

test('the band holds four hidden Buttons: on the diff panel\'s file-list actions, whose default keys are Alt+↑ and Ctrl+↑, Alt+↓ and Ctrl+↓, and on strip:jump9 and strip:jump8, for an Alt+E and Alt+Shift+E the person binds', async ($, on) => {
  const { band } = await world($, on)
  const buttons = await band.findAll({ type: 'Button' })
  expect(buttons.map(b => [b.key, b.props.action, b.props.label])).toEqual([
    ['effort-up-arrow', 'app:diffFileListUp', 'effort up'],
    ['effort-down-arrow', 'app:diffFileListDown', 'effort down'],
    ['effort-up', 'strip:jump9', 'effort up'],
    ['effort-down', 'strip:jump8', 'effort down'],
  ])
  // All four in one Box drawn as nothing, so the band shows only what the plugins beneath draw.
  const hidden = (await band.findAll({ type: 'Box' })).filter(box => box.props.display === 'none')
  expect(hidden.length).toBe(1)
  expect(hidden[0]!.children.map(child => (child as RenderElement).type)).toEqual(['Button', 'Button', 'Button', 'Button'])
})

test('with no keybinding of the person\'s, Alt+↑ steps up and Alt+↓ down as Alt+E and Alt+Shift+E do: stopping at the ends, for the agent in view, each pair going on from the level the other left', async ($, on) => {
  const { sent, request, footer, view, up, down, upArrow, downArrow } = await world($, on)
  await request('medium', 'a1')
  expect(await footer()).toBe('Opus 5.5 ▰▰▰▱▱ high')
  await upArrow()
  await upArrow()
  expect(await footer()).toBe('Opus 5.5 ▰▰▰▰▰ max')
  // Up stops at max; down steps back.
  await upArrow()
  expect(await footer()).toBe('Opus 5.5 ▰▰▰▰▰ max')
  await downArrow()
  expect(await footer()).toBe('Opus 5.5 ▰▰▰▰▱ xhigh')
  // Alt+Shift+E and Alt+↓ step the same level, one after the other.
  await down()
  await downArrow()
  expect(await footer()).toBe('Opus 5.5 ▰▰▱▱▱ medium')
  await up()
  expect(await footer()).toBe('Opus 5.5 ▰▰▰▱▱ high')

  // In a subagent's transcript they step that agent alone.
  await view('a1')
  expect(await footer()).toBe('Explore · Opus 5.5 ▰▰▱▱▱ medium')
  await upArrow()
  expect(await footer()).toBe('Explore · Opus 5.5 ▰▰▰▱▱ high')
  await downArrow()
  await downArrow()
  await downArrow()
  expect(await footer()).toBe('Explore · Opus 5.5 ▰▱▱▱▱ low')
  await view()
  expect(await footer()).toBe('Opus 5.5 ▰▰▰▱▱ high')
  await upArrow()
  await request('high')
  await request('medium', 'a1')
  expect(sent.slice(1)).toEqual(['main:xhigh', 'a1:low'])
})

test('Alt+↑ and Alt+↓ step only through the levels the include toggles allow', { options: { includeLow: false, includeMax: false } }, async ($, on) => {
  const { request, footer, view, upArrow, downArrow } = await world($, on)
  await upArrow()
  await upArrow()
  expect(await footer()).toBe('Opus 5.5 ▰▰▰▰▱ xhigh')
  await downArrow()
  await downArrow()
  await downArrow()
  expect(await footer()).toBe('Opus 5.5 ▰▰▱▱▱ medium')
  await request('medium', 'a1')
  await view('a1')
  await downArrow()
  expect(await footer()).toBe('Explore · Opus 5.5 ▰▰▱▱▱ medium')
  await upArrow()
  await upArrow()
  await upArrow()
  expect(await footer()).toBe('Explore · Opus 5.5 ▰▰▰▰▱ xhigh')
})

test('each agent keeps its own level: the keys step the agent in view, the footer shows its level, its requests carry it', async ($, on) => {
  const { sent, request, footer, view, up, down } = await world($, on)
  // Explore starts at its definition's medium, the general-purpose agent at the high it inherits.
  await request('medium', 'a1')
  await request('high', 'a2')
  expect(await footer()).toBe('Opus 5.5 ▰▰▰▱▱ high')

  await view('a1')
  expect(await footer()).toBe('Explore · Opus 5.5 ▰▰▱▱▱ medium')
  await up()
  expect(await footer()).toBe('Explore · Opus 5.5 ▰▰▰▱▱ high')
  await view('a2')
  expect(await footer()).toBe('general-purpose · Opus 5.5 ▰▰▰▱▱ high')
  await down()
  await down()
  expect(await footer()).toBe('general-purpose · Opus 5.5 ▰▱▱▱▱ low')
  await view()
  expect(await footer()).toBe('Opus 5.5 ▰▰▰▱▱ high')
  await up()
  expect(await footer()).toBe('Opus 5.5 ▰▰▰▰▱ xhigh')

  await request('high')
  await request('medium', 'a1')
  await request('high', 'a2')
  expect(sent.slice(2)).toEqual(['main:xhigh', 'a1:high', 'a2:low'])
  await view('a1')
  expect(await footer()).toBe('Explore · Opus 5.5 ▰▰▰▱▱ high')
})

test('an agent\'s meter is empty until its first request says its level, and a press leaves it saying wait; the engine changing its level drops the pick', async ($, on) => {
  const { clock, sent, request, footer, view, up } = await world($, on)
  await view('a1')
  expect(await footer()).toBe('Explore · ▱▱▱▱▱ —')
  await up()
  expect(await footer()).toBe('Explore · ▱▱▱▱▱ wait')
  await clock.advance(1000)
  expect(await footer()).toBe('Explore · ▱▱▱▱▱ —')
  await request('medium', 'a1')
  expect(await footer()).toBe('Explore · Opus 5.5 ▰▰▱▱▱ medium')
  await up()
  await request('medium', 'a1')
  // The engine sends it at low from now on (the person's /effort, inherited): its way wins, as on main.
  await request('low', 'a1')
  expect(sent).toEqual(['a1:medium', 'a1:high', 'a1:low'])
  expect(await footer()).toBe('Explore · Opus 5.5 ▰▱▱▱▱ low')
})

test('the line under an Agent call shows the level of the agent it started, and follows the keys', async ($, on) => {
  on('agent.spawn', (_, e) => ({ model: 'claude-opus-5-5', agentId: e.tool_use_id === 'toolu_a' ? 'a1' : 'a2' }))
  on('ui.render', { component: 'ToolUse' }, (): RenderElement => ({ type: 'Box', props: { key: 'engine' }, children: [{ type: 'Text', children: ['Explore(Find the config)'] }] }))
  const { request, view, up } = await world($, on)
  await $.agent.spawn({ tool_use_id: 'toolu_a', description: 'Find the config', prompt: 'Find it.', subagentType: 'Explore', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false } as any)
  const row = await $.ui.mount({
    plugin: 'effort-cycle', surface: 'terminal', component: 'ToolUse', requestId: 'toolu_a',
    props: { tool_use_id: 'toolu_a', tool: 'Agent', input: { description: 'Find the config', prompt: 'Find it.', subagent_type: 'Explore' }, isRunning: true, isErrored: false, isInterrupted: false },
  })
  const line = async () => (await row.find({ key: 'effort' }))?.text

  // Before the agent's first request the row is the engine's alone.
  expect(await line()).toBeUndefined()
  expect((await row.find({ key: 'engine' }))?.text).toBe('Explore(Find the config)')
  await request('medium', 'a1')
  expect(await line()).toBe('Opus 5.5 ▰▰▱▱▱ medium')
  await view('a1')
  await up()
  expect(await line()).toBe('Opus 5.5 ▰▰▰▱▱ high')
  expect((await row.find({ key: 'engine' }))?.text).toBe('Explore(Find the config)')
})

test('two surfaces drawing the band keep their own view: the terminal in a subagent, a remote surface on the main thread', async ($, on) => {
  const { request, footer, view, up } = await world($, on)
  await request('medium', 'a1')
  // A remote surface (Claude Code Desktop, attached over Remote Control) draws the band and footer too, on the main thread.
  await $.ui.mount({ plugin: 'effort-cycle', surface: 'desktop', component: 'AbovePrompt', props: BAND })
  const remote = await $.ui.mount({ plugin: 'effort-cycle', surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
  const remoteFooter = async () => spaced((await remote.find({ key: 'effort' }))?.text)
  await view('a1')
  expect(await footer()).toBe('Explore · Opus 5.5 ▰▰▱▱▱ medium')
  expect(await remoteFooter()).toBe('Opus 5.5 ▰▰▰▱▱ high')
  await up()
  expect(await footer()).toBe('Explore · Opus 5.5 ▰▰▰▱▱ high')
  expect(await remoteFooter()).toBe('Opus 5.5 ▰▰▰▱▱ high')
})

// The files the plugin writes, as the test records them, and where a tasks list row's parts go for session s1; and the
// process's environment, with each variable the plugin set.
function files(on: On) {
  const writes: { path: string; text: string }[] = []
  on('fs.write', (_, e) => {
    writes.push(e)
    return { value: undefined }
  })
  const env: Record<string, string | undefined> = { HOME: '/home/u' }
  const sets: string[] = []
  on('env.get', (_, e) => ({ value: env[e.name] }))
  on('env.set', (_, e) => {
    env[e.name] = e.value
    sets.push(e.name)
    return { value: undefined }
  })
  on('session.id', () => ({ value: 's1' }))
  // The last write's parts, colors left out.
  const parts = () => {
    const last = JSON.parse(writes.at(-1)?.text ?? '{}') as { order?: number; agents?: Record<string, string> }
    return { ...last, agents: Object.fromEntries(Object.entries(last.agents ?? {}).map(([id, text]) => [id, text.replace(/\x1b\[[0-9;]*m/g, '')])) }
  }
  return { writes, parts, env, sets }
}

// The plugin's own setting, from its settings.json, as the merged settings hold it while no settings file names one.
const PLUGIN_ROWS = { type: 'command', command: '[ -z "$EFFORT_CYCLE_ROWS" ] || exec python3 -I -S "$EFFORT_CYCLE_ROWS"' }

test('as the session starts, EFFORT_CYCLE_ROWS names the installed version\'s rows.py, which the plugin\'s own subagentStatusLine command runs; a later start on the same install leaves it', async ($, on) => {
  const { env, sets } = files(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  expect(env.EFFORT_CYCLE_ROWS).toMatch(/\/subagent-rows\/rows\.py$/)
  expect(sets).toEqual(['EFFORT_CYCLE_ROWS'])
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  expect(sets).toEqual(['EFFORT_CYCLE_ROWS'])
})

test('with the plugin\'s own subagentStatusLine and no session start seen (the plugin enabled mid-session), the first write of the rows points EFFORT_CYCLE_ROWS at the script', async ($, on) => {
  const { writes, parts, env } = files(on)
  const { request } = await world($, on, { effortLevel: 'high', subagentStatusLine: PLUGIN_ROWS })
  expect(env.EFFORT_CYCLE_ROWS).toBeUndefined()
  await request('medium', 'a1')
  expect(writes.length).toBe(1)
  expect(parts().agents).toEqual({ a1: 'Opus 5.5 ▰▰▱▱▱ medium' })
  expect(env.EFFORT_CYCLE_ROWS).toMatch(/\/subagent-rows\/rows\.py$/)
})

test('with a subagentStatusLine command in settings, each subagent\'s model and level are left for its tasks list row as the footer writes them, with no carets, and follow the keys', async ($, on) => {
  const { writes, parts } = files(on)
  const { request, view, up } = await world($, on, { effortLevel: 'high', subagentStatusLine: { type: 'command', command: 'rows' } })
  await request('medium', 'a1', 'claude-sonnet-5-5')
  await request('high', 'a2')
  expect(writes.at(-1)?.path).toBe('/home/u/.claude/subagent-rows/sessions/s1/effort-cycle.json')
  expect(parts()).toEqual({ order: 10, agents: { a1: 'Sonnet 5.5 ▰▰▱▱▱ medium', a2: 'Opus 5.5 ▰▰▰▱▱ high' } })
  // The footer's colors: the model dim, the filled blocks and the word in the level's color, the empty blocks dim.
  expect(JSON.parse(writes.at(-1)!.text).agents.a2).toBe('\x1b[2mOpus 5.5\x1b[22m \x1b[33m▰▰▰\x1b[39m\x1b[2m▱▱\x1b[22m \x1b[33mhigh\x1b[39m')

  // A request at the level it already has writes nothing.
  const before = writes.length
  await request('medium', 'a1', 'claude-sonnet-5-5')
  expect(writes.length).toBe(before)
  await view('a1')
  await up()
  expect(parts().agents).toEqual({ a1: 'Sonnet 5.5 ▰▰▰▱▱ high', a2: 'Opus 5.5 ▰▰▰▱▱ high' })
  // At max the model's name turns red too and the word is bold, as in the footer.
  await up()
  await up()
  expect(JSON.parse(writes.at(-1)!.text).agents.a1).toBe('\x1b[31mSonnet 5.5\x1b[39m \x1b[31m▰▰▰▰▰\x1b[39m \x1b[1;31mmax\x1b[22;39m')
  // The main thread has no row there: its steps write nothing.
  await view()
  await up()
  expect(writes.length).toBe(before + 3)
})

test('without a subagentStatusLine command nothing is written, and the levels it kept go out at the first write once there is one', async ($, on) => {
  const { writes, parts } = files(on)
  const settings: Record<string, unknown> = { effortLevel: 'high' }
  const { request } = await world($, on, settings)
  await request('medium', 'a1')
  expect(writes).toEqual([])
  settings.subagentStatusLine = { type: 'command', command: 'rows' }
  await request('xhigh', 'a2')
  expect(parts().agents).toEqual({ a1: 'Opus 5.5 ▰▰▱▱▱ medium', a2: 'Opus 5.5 ▰▰▰▰▱ xhigh' })
})

// An Agent call's spawn as the engine answers it, for the agent `agentId` on `subagentType`.
const spawnCall = ($: Engine, tool_use_id: string, subagentType: string) =>
  $.agent.spawn({ tool_use_id, description: 'a task', prompt: 'Do it.', subagentType, provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false } as any)

test('a subagent\'s spawn writes its row\'s part at once, its model beside the footer\'s empty meter, which the footer shows too, and its first request fills in the level', async ($, on) => {
  const { writes, parts } = files(on)
  on('agent.spawn', (_, e) => ({ model: e.tool_use_id === 'toolu_a' ? 'claude-sonnet-5-5' : 'claude-opus-5-5', agentId: e.tool_use_id === 'toolu_a' ? 'a1' : 'a2' }))
  const { request, footer, view, up } = await world($, on, { effortLevel: 'high', subagentStatusLine: { type: 'command', command: 'rows' } })
  await spawnCall($, 'toolu_a', 'Explore')
  expect(writes.at(-1)?.path).toBe('/home/u/.claude/subagent-rows/sessions/s1/effort-cycle.json')
  expect(parts()).toEqual({ order: 10, agents: { a1: 'Sonnet 5.5 ▱▱▱▱▱ —' } })
  expect(JSON.parse(writes.at(-1)!.text).agents.a1).toBe('\x1b[2mSonnet 5.5\x1b[22m \x1b[2m▱▱▱▱▱\x1b[22m \x1b[2m—\x1b[22m')
  await spawnCall($, 'toolu_b', 'general-purpose')
  expect(parts().agents).toEqual({ a1: 'Sonnet 5.5 ▱▱▱▱▱ —', a2: 'Opus 5.5 ▱▱▱▱▱ —' })
  expect(writes.length).toBe(2)
  await view('a1')
  expect(await footer()).toBe('Explore · Sonnet 5.5 ▱▱▱▱▱ —')
  // The level is still unknown: a press says wait, as before, and writes nothing.
  await up()
  expect(await footer()).toBe('Explore · Sonnet 5.5 ▱▱▱▱▱ wait')
  expect(writes.length).toBe(2)
  await request('high', 'a2')
  expect(parts().agents).toEqual({ a1: 'Sonnet 5.5 ▱▱▱▱▱ —', a2: 'Opus 5.5 ▰▰▰▱▱ high' })
  await request('medium', 'a1', 'claude-sonnet-5-5')
  expect(parts().agents).toEqual({ a1: 'Sonnet 5.5 ▰▰▱▱▱ medium', a2: 'Opus 5.5 ▰▰▰▱▱ high' })
  expect(await footer()).toBe('Explore · Sonnet 5.5 ▰▰▱▱▱ medium')
})

test('without a subagentStatusLine command a spawn writes nothing either', async ($, on) => {
  const { writes } = files(on)
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  const { footer, view } = await world($, on)
  await spawnCall($, 'toolu_a', 'Explore')
  expect(writes).toEqual([])
  await view('a1')
  expect(await footer()).toBe('Explore · Opus 5.5 ▱▱▱▱▱ —')
})

// The host beneath the width nudge: the surfaces said to draw the session, and each command the plugin ran there,
// which a host that cannot start it (no python3) refuses.
function host(on: On, surfaces: readonly ('terminal' | 'desktop')[] = ['terminal'], { canRun = true } = {}) {
  const runs: (readonly string[])[] = []
  on('session.surfaces', () => ({ value: surfaces }))
  on('process.run', (_, e) => {
    runs.push(e.argv)
    if (!canRun) return { deny: 'python3: command not found' }
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return runs
}
const ROWS = { effortLevel: 'high', subagentStatusLine: { type: 'command', command: 'rows' } }
// The command a nudge runs: python3, isolated, the script narrowing and restoring the terminal's width.
const NUDGE = ['python3', '-I', '-S', '-c', expect.stringContaining('TIOCSWINSZ')]

test('with "Tasks list rows: update at once" off, as by default, a changed level is written and the terminal is left alone', async ($, on) => {
  const { writes } = files(on)
  const runs = host(on)
  const { clock, request, view, up, click } = await world($, on, ROWS)
  await request('medium', 'a1')
  await view('a1')
  await up()
  await clock.advance(1000)
  await click('effort-up')
  await clock.settle()
  expect(writes.length).toBe(3)
  expect(runs).toEqual([])
})

test('with it on, a written change nudges the terminal, once a burst: the first change at once, those within 250 ms riding on it, a later one again; the engine taking over nudges too, a spawn\'s write and the main thread\'s steps do not', { options: { nudgeRows: true } }, async ($, on) => {
  const { writes, parts } = files(on)
  const runs = host(on)
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  const { clock, request, view, up, down, click, footer } = await world($, on, ROWS)
  // The spawn's write: Claude Code reruns the command for a new agent by itself.
  await spawnCall($, 'toolu_a', 'Explore')
  await clock.settle()
  expect(writes.length).toBe(1)
  expect(runs).toEqual([])
  // The agent's first request says its level: a change, written and nudged.
  await request('medium', 'a1')
  await clock.settle()
  expect(runs).toEqual([NUDGE])

  // A burst of presses and a click within 250 ms of it: each written, none nudging again.
  await view('a1')
  await clock.advance(100)
  await up()
  await up()
  await click('effort-down')
  await clock.advance(149)
  await down()
  expect(await footer()).toBe('Explore · Opus 5.5 ▰▰▱▱▱ medium')
  expect(writes.length).toBe(6)
  expect(runs.length).toBe(1)
  // A press after that nudges again, and starts a new burst.
  await clock.advance(1)
  await up()
  await up()
  expect(parts().agents).toEqual({ a1: 'Opus 5.5 ▰▰▰▰▱ xhigh' })
  expect(runs.length).toBe(2)
  // Up to max, a change, nudges; a press past the end changes nothing, so writes and nudges nothing.
  await clock.advance(1000)
  await up()
  expect(runs.length).toBe(3)
  await clock.advance(1000)
  await up()
  expect(writes.length).toBe(9)
  expect(runs.length).toBe(3)
  // The engine taking over (the person's /effort, inherited) is a change too.
  await clock.advance(1000)
  await request('low', 'a1')
  await clock.settle()
  expect(parts().agents).toEqual({ a1: 'Opus 5.5 ▰▱▱▱▱ low' })
  expect(runs.length).toBe(4)
  // The main thread has no row: its steps write and nudge nothing.
  await view()
  await clock.advance(1000)
  await up()
  await clock.settle()
  expect(writes.length).toBe(10)
  expect(runs.length).toBe(4)
  expect(runs.every(run => JSON.stringify(run) === JSON.stringify(runs[0]))).toBe(true)
})

test('with it on, Alt+↑ and Alt+↓ on a subagent write its row and nudge the terminal as Alt+E does; a press past the end, nothing', { options: { nudgeRows: true } }, async ($, on) => {
  const { writes, parts } = files(on)
  const runs = host(on)
  const { clock, request, view, upArrow, downArrow, footer } = await world($, on, ROWS)
  await request('medium', 'a1')
  await clock.settle()
  expect(runs).toEqual([NUDGE])
  await view('a1')
  await clock.advance(1000)
  await upArrow()
  expect(parts().agents).toEqual({ a1: 'Opus 5.5 ▰▰▰▱▱ high' })
  expect(runs.length).toBe(2)
  await clock.advance(1000)
  await downArrow()
  await downArrow()
  expect(await footer()).toBe('Explore · Opus 5.5 ▰▱▱▱▱ low')
  expect(parts().agents).toEqual({ a1: 'Opus 5.5 ▰▱▱▱▱ low' })
  expect(runs.length).toBe(3)
  const written = writes.length
  await clock.advance(1000)
  await downArrow()
  await clock.settle()
  expect(writes.length).toBe(written)
  expect(runs.length).toBe(3)
})

test('with it on, nothing is nudged where no terminal draws the session (a desktop or remote host, a headless run)', { options: { nudgeRows: true } }, async ($, on) => {
  const { writes } = files(on)
  const runs = host(on, ['desktop'])
  const { clock, request, view, up } = await world($, on, ROWS, 'desktop')
  await request('medium', 'a1')
  await view('a1')
  for (let i = 0; i < 3; i++) {
    await clock.advance(1000)
    await up()
  }
  await clock.settle()
  expect(writes.length).toBe(4)
  expect(runs).toEqual([])
})

test('with it on, a host that cannot start the nudge (no python3) never reaches the keys or the clicks, and is not asked again', { options: { nudgeRows: true } }, async ($, on) => {
  const { parts } = files(on)
  const runs = host(on, ['terminal'], { canRun: false })
  const { clock, request, view, up, click, footer } = await world($, on, ROWS)
  await request('medium', 'a1')
  await view('a1')
  await clock.advance(1000)
  await up()
  expect(await footer()).toBe('Explore · Opus 5.5 ▰▰▰▱▱ high')
  await clock.advance(1000)
  await click('effort-up')
  expect(await footer()).toBe('Explore · Opus 5.5 ▰▰▰▰▱ xhigh')
  await clock.settle()
  expect(parts().agents).toEqual({ a1: 'Opus 5.5 ▰▰▰▰▱ xhigh' })
  expect(runs.length).toBe(1)
})

test('a spawn that resolves after the agent\'s first request leaves what the request said', async ($, on) => {
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  const { request, footer, view } = await world($, on)
  await request('medium', 'a1', 'claude-sonnet-5-5')
  await $.agent.spawn({ tool_use_id: 'toolu_a', description: 'a task', prompt: 'Do it.', subagentType: 'Explore', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false } as any)
  await view('a1')
  expect(await footer()).toBe('Explore · Sonnet 5.5 ▰▰▱▱▱ medium')
})

// The footer's label as the surface paints it: a Box placed over its cells (a caret) hidden, or, while the pointer is
// over the label and the label's hover reveals it, painted over them, a Client in it as its module drew it.
async function painted(label: { find: (q: { key: string }) => Promise<{ children: unknown[] } | undefined>; drawn: (scope?: { in?: string }) => Promise<unknown> }, isHovered: boolean): Promise<string> {
  type Node = { type?: string; props?: Record<string, unknown>; hover?: Record<string, unknown>; children?: unknown[] }
  const read = async (node: unknown): Promise<string> => {
    if (typeof node === 'string') return node
    const { type, props = {}, children = [] } = node as Node
    if (type === 'Client') return read(await label.drawn({ in: String(props.key) }))
    const placed = children.find(child => (child as Node).props?.position === 'absolute') as Node | undefined
    if (placed !== undefined && isHovered && placed.hover?.display === 'flex') return (await Promise.all((placed.children ?? []).map(read))).join('')
    return (await Promise.all(children.filter(child => child !== placed).map(read))).join('')
  }
  return (await Promise.all(((await label.find({ key: 'effort' }))?.children ?? []).map(read))).join('')
}

// The path from the label's keyed Box down to a caret's Client: every Box on the way, and the Client.
function pathTo(tree: unknown, key: string): { type?: string; props?: Record<string, unknown>; hover?: Record<string, unknown> }[] | undefined {
  type Node = { type?: string; props?: Record<string, unknown>; hover?: Record<string, unknown>; children?: unknown[] }
  const node = tree as Node
  if (typeof tree !== 'object' || tree === null) return undefined
  if (node.type === 'Client' && node.props?.key === key) return [node]
  for (const child of node.children ?? []) {
    const below = pathTo(child, key)
    if (below !== undefined) return [node, ...below]
  }
  return undefined
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`on the ${surface}, the footer keeps three blank cells either side of the meter and word, where a ‹ and a › show while the pointer is over the label, never inverted`, async ($, on) => {
    const { label, up, footer } = await world($, on, undefined, surface)
    expect((await label.find({ key: 'effort' }))?.text).toBe('Opus 5.5   ▰▰▰▱▱ high     ')
    expect(await painted(label, false)).toBe('Opus 5.5   ▰▰▰▱▱ high     ')
    expect(await painted(label, true)).toBe('Opus 5.5 ‹ ▰▰▰▱▱ high   › ')
    // Nothing moves as the level changes: the word's slot is as wide as the widest, so the › stays where it was clicked.
    await up()
    expect(await painted(label, true)).toBe('Opus 5.5 ‹ ▰▰▰▰▱ xhigh  › ')
    await up()
    expect(await painted(label, true)).toBe('Opus 5.5 ‹ ▰▰▰▰▰ max    › ')
    expect(await footer()).toBe('Opus 5.5 ▰▰▰▰▰ max')

    // Each caret is drawn hidden in a Box placed over its cells, which the hover of the label's keyed Box reveals: no
    // keyed Box between the two, which would make the caret's own cells its scope.
    for (const key of ['effort-down', 'effort-up']) {
      const path = pathTo((await label.find({ key: 'effort' })) as unknown, key)!
      const [cells, placed, client] = path.slice(-3)
      expect(path[0]?.props?.key).toBe('effort')
      expect(path.slice(1, -1).every(box => box.props?.key === undefined)).toBe(true)
      expect(cells?.props).toMatchObject({ width: 3, flexShrink: 0 })
      expect(placed?.props).toMatchObject({ position: 'absolute', top: 0, left: 0, display: 'none' })
      expect(placed?.hover).toEqual({ display: 'flex' })
      expect(client?.props).toMatchObject({ width: 3, height: 1 })
    }

    // Dim at rest, at full strength under the pointer, and never inverted, held or not.
    const caret = async () => (await label.find({ type: 'Text', text: /^‹$/, in: 'effort-down' }))?.props
    const drawings = async () => JSON.stringify([await label.drawn(), await label.drawn({ in: 'effort-down' }), await label.drawn({ in: 'effort-up' })])
    expect(await caret()).toMatchObject({ dimColor: true })
    await label.pointer({ type: 'enter', x: 1, y: 0, in: 'effort-down' })
    expect(await caret()).toMatchObject({ dimColor: false })
    await label.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'effort-down' })
    expect(await drawings()).not.toContain('inverse')
    await label.pointer({ type: 'up', x: 1, y: 0, button: 'left', in: 'effort-down' })
    await label.pointer({ type: 'leave', x: 1, y: 0, in: 'effort-down' })
    expect(await caret()).toMatchObject({ dimColor: true })
    expect(await drawings()).not.toContain('inverse')
  })

  test(`on the ${surface}, a click on › steps up and on ‹ down as Alt+E and Alt+Shift+E do, for the agent the footer shows: stopping at the ends with the word lit, and saying wait while an agent's level is unknown`, async ($, on) => {
    const { clock, sent, request, footer, view, click, label } = await world($, on, undefined, surface)
    const word = () => label.find({ type: 'Text', text: /^[a-z]+ *$/ })
    await click('effort-up')
    expect(await footer()).toBe('Opus 5.5 ▰▰▰▰▱ xhigh')
    // The block it filled lights for a moment, as after a key.
    expect((await label.findAll({ type: 'Text', text: /^[▰▱]$/ })).map(b => b.props.color ?? 'dim')).toEqual(['claude', 'claude', 'claude', 'text', 'dim'])
    await click('effort-up')
    await click('effort-up')
    expect(await footer()).toBe('Opus 5.5 ▰▰▰▰▰ max')
    expect((await word())?.props).toMatchObject({ color: 'text', bold: true })
    await clock.advance(1000)
    expect((await word())?.props).toMatchObject({ color: 'error', bold: true })
    await request('high')
    expect(sent.at(-1)).toBe('main:max')

    // In a subagent's transcript the carets step that agent alone.
    await request('medium', 'a1')
    await view('a1')
    await click('effort-down')
    await click('effort-down')
    expect(await footer()).toBe('Explore · Opus 5.5 ▰▱▱▱▱ low')
    expect((await word())?.props).toMatchObject({ color: 'text', bold: true })
    await request('medium', 'a1')
    expect(sent.at(-1)).toBe('a1:low')
    await view()
    expect(await footer()).toBe('Opus 5.5 ▰▰▰▰▰ max')
    // An agent no request of whose has said its level yet: a click leaves it and says wait.
    await view('a2')
    await click('effort-up')
    expect(await footer()).toBe('general-purpose · ▱▱▱▱▱ wait')
    await clock.advance(1000)
    expect(await footer()).toBe('general-purpose · ▱▱▱▱▱ —')
  })
}

test('every click on a caret steps once, however quick: on any of its three cells, clicks whose steps overlap, a post the frame replaced', async ($, on) => {
  const { footer, click, label, up } = await world($, on)
  for (const x of [0, 1, 2]) await click('effort-down', x)
  expect(await footer()).toBe('Opus 5.5 ▰▱▱▱▱ low')
  for (const x of [0, 1, 2]) await click('effort-up', x)
  expect(await footer()).toBe('Opus 5.5 ▰▰▰▰▱ xhigh')
  // Two clicks, and a key, whose steps would run at once: each reads the level the one before wrote.
  await Promise.all([click('effort-down'), click('effort-down'), up()])
  expect(await footer()).toBe('Opus 5.5 ▰▰▰▱▱ high')

  // A caret posts its running count of presses: the first post heard counts each press so far, a later one the presses
  // since, so the posts a frame replaced still step; a post heard twice steps nothing the second time.
  const post = (presses: number) => label.post({ caret: 'c1', presses, by: -1 }, { in: 'effort-down' })
  await post(1)
  expect(await footer()).toBe('Opus 5.5 ▰▰▱▱▱ medium')
  await post(2)
  await post(2)
  expect(await footer()).toBe('Opus 5.5 ▰▱▱▱▱ low')
  await label.post({ caret: 'c2', presses: 3, by: 1 }, { in: 'effort-up' })
  expect(await footer()).toBe('Opus 5.5 ▰▰▰▰▱ xhigh')
  // A count below the last one heard is a caret whose module loaded again: all of it is new.
  await post(1)
  expect(await footer()).toBe('Opus 5.5 ▰▰▰▱▱ high')
  // Anything else a module posts steps nothing.
  await label.post({ caret: 'c1', presses: 9, by: 2 }, { in: 'effort-down' })
  await label.post('down', { in: 'effort-down' })
  expect(await footer()).toBe('Opus 5.5 ▰▰▰▱▱ high')
})

test('the carets step only through the levels the include toggles allow', { options: { includeLow: false, includeMax: false } }, async ($, on) => {
  const { footer, click } = await world($, on, { effortLevel: 'medium' })
  for (let i = 0; i < 3; i++) await click('effort-up')
  expect(await footer()).toBe('Opus 5.5 ▰▰▰▰▱ xhigh')
  for (let i = 0; i < 3; i++) await click('effort-down')
  expect(await footer()).toBe('Opus 5.5 ▰▰▱▱▱ medium')
})

test('each surface\'s carets step the agent its own footer shows: the terminal in a subagent, a remote surface on the main thread', async ($, on) => {
  const { request, footer, view, click } = await world($, on)
  await request('medium', 'a1')
  await $.ui.mount({ plugin: 'effort-cycle', surface: 'desktop', component: 'AbovePrompt', props: BAND })
  const remote = await $.ui.mount({ plugin: 'effort-cycle', surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
  const remoteFooter = async () => spaced((await remote.find({ key: 'effort' }))?.text)
  await view('a1')
  await click('effort-up')
  await remote.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'effort-down' })
  await remote.pointer({ type: 'up', x: 1, y: 0, button: 'left', in: 'effort-down' })
  expect(await footer()).toBe('Explore · Opus 5.5 ▰▰▰▱▱ high')
  expect(await remoteFooter()).toBe('Opus 5.5 ▰▰▱▱▱ medium')
})
