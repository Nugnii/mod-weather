import { expect, test } from 'claude-code/testing'

import { decide, tokens, weather } from '../hooks/register'

test('the scale names the screenshots’ levels', async () => {
  expect(weather(0).name).toBe('Ясно')
  expect(weather(30).name).toBe('Малооблачно')
  expect(weather(48).name).toBe('Облачно')
  expect(weather(62).name).toBe('Дождь')
  expect(weather(78).name).toBe('Гроза')
  expect(weather(91).name).toBe('Пора сжимать')
})

test('a cold cache holds the first Enter and lets a second one within 2 min through', async () => {
  const mark = { at: 0, ttl: '5m' } as const
  const warned = { at: 301_000, minutes: 5, tokens: 96_000 }

  expect(decide(null, null, 10_000_000)).toBe('send')
  expect(decide(mark, null, 299_000)).toBe('send')
  expect(decide(mark, null, 301_000)).toBe('hold')
  expect(decide(mark, warned, 400_000)).toBe('confirm')
  expect(decide(mark, warned, 301_000 + 121_000)).toBe('hold')
  expect(decide({ at: 0, ttl: '1h' }, null, 3_000_000)).toBe('send')
})

test('token counts', async () => {
  expect(tokens(124_000)).toBe('124k')
  expect(tokens(1_000_000)).toBe('1M')
})

const BAND = {
  plugin: 'context-weather',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
    rows: [],
  },
} as const

test('the band draws a live 1M session: every limit window, known names first', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  // The owner's live session: a 1M window, the windows out of order, one under a name
  // the mod does not know.
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 357_000, window: 1_000_000, percent: 36 },
      rateLimits: [
        { kind: 'seven_day', percentUsed: 25 },
        { kind: 'seven_day_opus', percentUsed: 12 },
        { kind: 'five_hour', percentUsed: 64 },
      ],
      cost: { usd: 9.72 } as never,
    },
  }))

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface } as never)

    expect((await ui.find({ type: 'Text', text: /Малооблачно/ }))?.text).toBe('⛅ Малооблачно')
    expect((await ui.find({ type: 'Text', text: /1M/ }))?.text).toBe('36% · 357k/1M')
    const limits = (await ui.findAll({ type: 'Text', text: /%$/ })).map(t => t.text)
    expect(limits).toEqual(['5ч 64%', 'неделя 25%', 'seven_day_opus 12%'])
    expect(await ui.find({ type: 'Text', text: /\$9\.72/ })).toBeDefined()
    expect(await ui.find({ key: 'hide' })).toBeDefined()
    await ui.unmount()
  }
})
