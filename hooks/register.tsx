import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Armed, CacheMark } from '../types'

const tickRef = atom({ plugin: 'context-weather', key: 'tick' } as const, 0)
const cacheRef = atom({ plugin: 'context-weather', key: 'cache' } as const, null as CacheMark | null)
const hiddenRef = atom({ plugin: 'context-weather', key: 'hidden' } as const, false)
const armedRef = atom({ plugin: 'context-weather', key: 'armed' } as const, null as Armed | null)

const BAR = 12
const CONFIRM_MS = 2 * 60_000
const TTL_MS = { '5m': 300_000, '1h': 3_600_000 } as const
// Every window the API reported is shown: known ones first under short names, any other by its own.
const LIMIT_LABEL: Record<string, string> = { five_hour: '5ч', seven_day: 'неделя' }
const rank = (kind: string) => {
  const i = Object.keys(LIMIT_LABEL).indexOf(kind)
  return i < 0 ? 99 : i
}

type Weather = { name: string; icon: string; color: string }

// ponytail: a fixed scale; move the thresholds if a level feels early or late.
export function weather(percent: number): Weather {
  if (percent >= 85) return { name: 'Пора сжимать', icon: '⚠', color: 'error' }
  if (percent >= 70) return { name: 'Гроза', icon: '⚡', color: 'error' }
  if (percent >= 55) return { name: 'Дождь', icon: '☂', color: 'warning' }
  if (percent >= 40) return { name: 'Облачно', icon: '☁', color: 'text' }
  if (percent >= 20) return { name: 'Малооблачно', icon: '⛅', color: 'suggestion' }
  return { name: 'Ясно', icon: '☀', color: 'success' }
}

export const tokens = (n: number) =>
  n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`

export const cacheLeftMs = (mark: CacheMark, now: number) => mark.at + TTL_MS[mark.ttl] - now

// send: cache warm or never written; hold: cold, warn first; confirm: cold, warned within 2 min.
export function decide(
  mark: CacheMark | null,
  armed: Armed | null,
  now: number,
): 'send' | 'hold' | 'confirm' {
  if (mark === null || cacheLeftMs(mark, now) > 0) return 'send'
  if (armed !== null && now - armed.at < CONFIRM_MS) return 'confirm'
  return 'hold'
}

export const coldText = (minutes: number, count: number) =>
  `Кеш, скорее всего, остыл: с последнего ответа прошло ${minutes} мин. ` +
  `Это сообщение заново прочитает весь диалог, около ${tokens(count)} токенов. ` +
  'Нажмите Enter ещё раз, чтобы отправить.'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'weather',
      description: 'Показать строку погоды контекста, если её скрыли',
    })
    // Redraws the cache minutes; every request redraws on its own.
    $.clock.every(30_000, () => void update($, tickRef, n => n + 1))

    return next(e)
  })

  on('command.run', { command: 'weather' }, async $ => {
    await update($, hiddenRef, () => false)

    return { text: 'Строка погоды контекста снова видна.' }
  })

  // The main conversation's requests: when each went out (the cache counts from there)
  // and for how long it was cached.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    const at = await $.clock.now()
    const result = yield* next(e)
    const usage = result.usage
    if (usage !== null) {
      await update($, cacheRef, old => {
        const ttl =
          (usage.ephemeral_1h_input_tokens ?? 0) > 0
            ? '1h'
            : (usage.ephemeral_5m_input_tokens ?? 0) > 0
              ? '5m'
              : (old?.ttl ?? '5m')
        return { at, ttl }
      })
    }
    await update($, tickRef, n => n + 1)

    return result
  })

  on('prompt.submit', async ($, e, next) => {
    // Only the person's own typed prompt; a command or one carrying images goes through,
    // since putting it back in the box would lose what is not text.
    if (e.origin.kind !== 'composer' || e.command !== undefined || (e.attachments?.length ?? 0) > 0) {
      return next(e)
    }
    const now = await $.clock.now()
    const mark = await read($, cacheRef)
    const verdict = decide(mark, await read($, armedRef), now)
    if (verdict === 'send') return next(e)
    if (verdict === 'confirm') {
      await update($, armedRef, () => null)
      return next(e)
    }
    const { context } = await $.session.usage()
    const minutes = mark === null ? 0 : Math.floor((now - mark.at) / 60_000)
    await update($, armedRef, () => ({ at: now, minutes, tokens: context.tokens ?? 0 }))
    await $.prompt.fill({ text: e.text })

    return { drop: 'Кеш остыл: Enter ещё раз отправит сообщение.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, hiddenRef))) return next(e)
    await read($, tickRef)
    const { Box, Text, Button } = $.ui.resolve(e)
    const now = await $.clock.now()
    const { context, rateLimits, cost } = await $.session.usage()
    const mark = await read($, cacheRef)
    const armed = await read($, armedRef)

    const percent =
      context.percent ?? (context.tokens === undefined ? 0 : (context.tokens / context.window) * 100)
    const sky = weather(percent)
    const filled = Math.max(0, Math.min(BAR, Math.round((percent / 100) * BAR)))
    const limits = [...rateLimits].sort((a, b) => rank(a.kind) - rank(b.kind))
    const left = mark === null ? 0 : cacheLeftMs(mark, now)

    return (
      <Box flexDirection="column">
        {armed !== null && now - armed.at < CONFIRM_MS && (
          <Box borderStyle="round" borderColor="warning" paddingX={1}>
            <Text color="warning">{coldText(armed.minutes, armed.tokens)}</Text>
          </Box>
        )}
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Text color={sky.color} bold>
            {`${sky.icon} ${sky.name}`}
          </Text>
          <Box flexDirection="row">
            {filled > 0 && <Text color={sky.color}>{'█'.repeat(filled)}</Text>}
            {filled < BAR && <Text dimColor>{'░'.repeat(BAR - filled)}</Text>}
          </Box>
          <Text>
            {context.tokens === undefined
              ? '—'
              : `${Math.round(percent)}% · ${tokens(context.tokens)}/${tokens(context.window)}`}
          </Text>
          {limits.map(l => (
            <Text {...(l.percentUsed >= 80 ? { color: 'warning' } : { dimColor: true })}>
              {`${LIMIT_LABEL[l.kind] ?? l.kind} ${Math.round(l.percentUsed)}%`}
            </Text>
          ))}
          {cost !== undefined && <Text dimColor>{`$${cost.usd.toFixed(2)}`}</Text>}
          {mark !== null &&
            (left > 0 ? (
              <Text dimColor>{`кеш: ещё ${Math.ceil(left / 60_000)} мин`}</Text>
            ) : (
              <Text color="error">кеш остыл</Text>
            ))}
          <Button key="hide" plain onPress={() => update($, hiddenRef, () => true)}>
            ×
          </Button>
        </Box>
      </Box>
    )
  })
}
