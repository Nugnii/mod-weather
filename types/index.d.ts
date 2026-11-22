// The main conversation's last model request: the moment its prompt cache counts from.
export type CacheMark = { at: number; ttl: '5m' | '1h' }

// A prompt held on a cold cache: when, how long the cache had been cold, the tokens it rereads,
// and, for a model with a known price, what sending costs cold and would have cost warm ($).
export type Armed = { at: number; minutes: number; tokens: number; cold?: number; warm?: number }

declare module 'claude-code' {
  interface PluginState {
    'context-weather': {
      tick: number
      cache: CacheMark | null
      hidden: boolean
      armed: Armed | null
    }
  }
}
