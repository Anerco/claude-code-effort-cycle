import { test, expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { AgentInfo, On, RenderElement, RenderPropsOf } from 'claude-code'

// Claude Code's own band, beneath every plugin: empty here, as with no survey up.
const engineBand = (on: On) => on('ui.render', { component: 'AbovePrompt' }, (): RenderElement => ({ type: 'Box', children: [] }))
const BAND: RenderPropsOf['AbovePrompt'] = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 19 }, view: {} }
const agent = (id: string, type: string, description = 'a task'): AgentInfo => ({ id, description, type, status: 'running' })

// A session on Opus 5.5 at high with two subagents, an Explore and a general-purpose; `sent` holds each
// request's agent and effort as it left the plugin, and `view` opens a transcript as the tasks list does.
async function world($: Engine, on: On) {
  engineBand(on)
  const clock = mock.clock(on)
  on('settings.read', () => ({ value: { effortLevel: 'high' } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  const listed = [agent('a1', 'Explore', 'Find the config'), agent('a2', 'general-purpose', 'Fix the parser')]
  on('agent.list', () => ({ value: listed }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const sent: string[] = []
  on('turn.step', async function* (_, e) {
    sent.push(`${e.agentId ?? 'main'}:${e.effort}`)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: null }
  })
  const request = async (effort: string, agentId?: string) => {
    const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', effort, messageCount: 1, ...(agentId && { agentId }) } as any)
    for await (const _ of stream);
  }
  const band = await $.ui.mount({ plugin: 'effort-cycle', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  const label = await $.ui.mount({ plugin: 'effort-cycle', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  await clock.settle()
  const footer = async () => (await label.find({ key: 'effort' }))?.text.trim()
  const view = async (agentId?: string) => {
    await band.redraw({ ...BAND, view: agentId === undefined ? {} : { agentId } })
    await clock.settle()
  }
  const up = () => band.press({ key: 'effort-up' })
  const down = () => band.press({ key: 'effort-down' })
  return { clock, band, listed, sent, request, footer, view, up, down }
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
  const footer = async () => (await label.find({ key: 'effort' }))?.text.trim()
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
  const footer = async () => (await label.find({ key: 'effort' }))?.text.trim()
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
  const word = () => label.find({ type: 'Text', text: /^ [a-z]+ *$/ })
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

test('the band keeps what the plugins beneath draw there, and Alt+E and Alt+Shift+E still step', {
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
  const footer = async () => (await label.find({ key: 'effort' }))?.text.trim()
  const theirs = async () => (await band.find({ key: 'other' }))?.text

  expect(await theirs()).toBe('theirs')
  await band.press({ key: 'effort-up' })
  expect(await footer()).toBe('Opus 5.5 ▰▰▰▰▱ xhigh')
  await band.press({ key: 'effort-down' })
  await band.press({ key: 'effort-down' })
  expect(await footer()).toBe('Opus 5.5 ▰▰▱▱▱ medium')
  expect(await theirs()).toBe('theirs')
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
  const remoteFooter = async () => (await remote.find({ key: 'effort' }))?.text.trim()
  await view('a1')
  expect(await footer()).toBe('Explore · Opus 5.5 ▰▰▱▱▱ medium')
  expect(await remoteFooter()).toBe('Opus 5.5 ▰▰▰▱▱ high')
  await up()
  expect(await footer()).toBe('Explore · Opus 5.5 ▰▰▰▱▱ high')
  expect(await remoteFooter()).toBe('Opus 5.5 ▰▰▰▱▱ high')
})

test('with the main thread in view the band has a row per live subagent with its level, gone in a subagent\'s view and when the agent ends', async ($, on) => {
  const { clock, band, listed, request, view, up } = await world($, on)
  const row = async (id: string) => (await band.find({ key: `effort-${id}` }))?.text
  await request('medium', 'a1')
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as any)
  await clock.settle()

  expect(await row('a1')).toBe('▰▰▱▱▱ medium  Opus 5.5 · Explore · Find the config')
  // The general-purpose agent has made no request yet: its row says so.
  expect(await row('a2')).toBe('▱▱▱▱▱ —       general-purpose · Fix the parser')
  await request('high', 'a2')
  expect(await row('a2')).toBe('▰▰▰▱▱ high    Opus 5.5 · general-purpose · Fix the parser')

  // In a subagent's view the rows give way to its footer, and a press there shows in its row back on main.
  await view('a1')
  expect(await row('a1')).toBeUndefined()
  await up()
  await view()
  expect(await row('a1')).toBe('▰▰▰▱▱ high    Opus 5.5 · Explore · Find the config')

  listed[1] = { ...listed[1]!, status: 'completed' }
  await clock.advance(2000)
  expect(await row('a2')).toBeUndefined()
  expect(await row('a1')).toBeDefined()
})
