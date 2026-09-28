import { test, expect, mock } from 'claude-code/testing'

test('Alt+E steps the level up and Alt+Shift+E down, stopping at the ends, the footer shows model and level, main-loop requests carry it, the engine taking over drops it', async ($, on) => {
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
