/** A subagent's effort: what its own requests carried and what the keys picked for it. */
export type AgentEffort = {
  /** The model its last request named. */
  model: string
  /** The engine's level on its last request, before the keys' pick: the one it was spawned with (its definition's effort, else the parent's) or the engine's since; null until a request of its carries a level. */
  base: string | null
  /** The level Alt+E or Alt+Shift+E picked while its transcript was in view, sent on its requests; null follows the engine's. */
  override: string | null
  /** What the footer calls it: its agent type, a teammate's name; absent when the session lists no such agent. */
  label?: string
}

declare module 'claude-code' {
  interface PluginState {
    'effort-cycle': {
      /** The level Alt+E or Alt+Shift+E picked for a model, sent on its main-loop requests; null follows the engine's own. */
      override: { model: string; level: string } | null
      /** The engine's own level for a model, as its last main-loop request carried it before the override. */
      base: { model: string; level: string } | null
      /** Each subagent's effort, by its agent id (the `agentId` its `turn.step` carries). */
      agents: StateFamily<AgentEffort>
      /** The agent an Agent call started, by the call's tool_use_id, so the call's row can show its effort. */
      spawns: StateFamily<string>
      /** The agent whose transcript is in view, as the band above the prompt last saw it; null while the main conversation is. */
      viewed: string | null
      /** The model the footer label last drew; a change (/model, alt+p) draws it again. */
      drawnModel: string
      /** The step Alt+E or Alt+Shift+E just made, as level indexes, whose blocks the meter lights for a moment (`from` equal to `to` is a press past the end, which lights the word); `id` counts the presses so only the latest clears it; `agentId` is the agent it stepped, null for the main thread. */
      flash: { id: number; from: number; to: number; agentId: string | null } | null
      /** The block the sweep lights at max while Claude works, by index; null between sweeps and otherwise. */
      swept: number | null
    }
  }
}
