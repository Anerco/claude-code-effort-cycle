declare module 'claude-code' {
  interface PluginState {
    'effort-cycle': {
      /** The level Alt+E or Alt+Shift+E picked for a model, sent on its main-loop requests; null follows the engine's own. */
      override: { model: string; level: string } | null
      /** The engine's own level for a model, as its last main-loop request carried it before the override. */
      base: { model: string; level: string } | null
      /** The model the footer label last drew; a change (/model, alt+p) draws it again. */
      drawnModel: string
      /** The step Alt+E or Alt+Shift+E just made, as level indexes, whose blocks the meter lights for a moment (`from` equal to `to` is a press past the end, which lights the word); `id` counts the presses so only the latest clears it. */
      flash: { id: number; from: number; to: number } | null
      /** The block the sweep lights at max while Claude works, by index; null between sweeps and otherwise. */
      swept: number | null
    }
  }
}
