# effort-cycle: effort level keyboard shortcuts for Claude Code

A Claude Code plugin that changes the reasoning effort level from the
keyboard, per agent, without leaving a row in the transcript:

- **Alt+E** steps the effort up: low → medium → high → xhigh → max, stopping at max.
- **Alt+Shift+E** steps it down, stopping at low.
- The keys change the agent in view: the main thread, or the subagent whose
  transcript you opened from the tasks list. Every other agent keeps its level.
- The footer shows that agent's model and level as they change, as a meter colored
  cool to hot (gray, green, yellow, orange, red, by theme color), the blocks a
  press fills or empties lit for a moment: `Opus 5.5 ▰▰▰▱▱ high`. A press past
  either end lights the level's word. At max the model name turns red too, and
  while Claude works a light sweeps across the bar. In a subagent's
  transcript the meter is that agent's, led by its type:
  `Explore · Opus 5.5 ▰▰▱▱▱ medium`.
- A line under each Agent call in the transcript shows the level of the agent
  it started.

![Alt+E steps the effort meter up to max, a light sweeps the bar while Claude works, Alt+Shift+E steps back down](demo.gif)

Each agent's level is its own and applies to that agent's next model requests.
A subagent starts at the level Claude Code gives it (its definition's
`effort`, else the main thread's), which the plugin reads off the subagent's
first model request; until then its meter is empty (`—`), and a press leaves
it and says `wait`. Changing effort Claude Code's way (`/effort`, the Alt+P
picker) takes over again from the next request, for the main thread and for
any subagent whose level Claude Code changes with it.

With the session also open on another surface over Remote Control (Claude
Code Desktop), each surface follows its own view: the keys step the agent that
surface is viewing.

What it hooks: each model request, the main thread's and every subagent's, to
read its effort level and set the one picked for that agent; each subagent's
start, to tie the Agent call to the agent it started; the `/effort` and
`/model` commands, which it lets run unchanged and only watches afterwards to
drop its own level and redraw the footer; the footer itself, to draw the
meter; the Agent calls' rows, to add the line under them; and the band above
the prompt, which says whose transcript is in view and where two hidden
buttons take the keys, leaving whatever other plugins and Claude Code show
there in place. It reads your
settings and the session's list of agents and nothing else, sends nothing
anywhere, and keeps its state in the session only.

Mods (plugins of function hooks) are an early-access Claude Code API that
changes between releases. This one is built and tested against Claude Code
2.1.289.

## Install

1. Install it from the [anerco marketplace](https://github.com/Anerco/plugins), in Claude Code:

   ```
   /plugin marketplace add Anerco/plugins
   /plugin install effort-cycle@anerco
   ```

   Or, to work on it, clone the repo and load the folder with
   `claude --plugin-dir <folder>`, or in every session through
   `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`.

2. Bind the keys in `~/.claude/keybindings.json`:

   ```json
   {
     "bindings": [
       { "context": "Global", "bindings": { "meta+e": "strip:jump9", "meta+shift+e": "strip:jump8" } }
     ]
   }
   ```

   A mod cannot own a key. It can only borrow one of Claude Code's own
   keybinding actions, so the mod listens for `strip:jump9` (up) and
   `strip:jump8` (down). Any modified key or chord works; a bare letter does
   not.

   On macOS, Option+E types an accent unless the terminal sends Option as
   Meta: in Terminal.app turn on **Use Option as Meta key** (Settings →
   Profiles → Keyboard), in iTerm2 set **Left Option key** to **Esc+**
   (Settings → Profiles → Keys), in Ghostty set `macos-option-as-alt = true`.
   Or bind a ctrl chord instead.

## Settings

`/config` lists five toggles, **Effort keys: include low** through **include
max**, all on by default. The keys step only through the levels that are on,
for every model.

The values are stored in `~/.claude/settings.json` under `pluginConfigs`,
under the plugin's key (`effort-cycle@anerco` when installed from the
marketplace).

## Known issues

- **The spinner can show a different level from the footer**
  ([#1](https://github.com/Anerco/claude-code-effort-cycle/issues/1)). The footer is the
  level the requests go out with; the spinner reads Claude Code's own state,
  which a mod cannot change.
- **The level is not kept after a restart.** An Alt+E pick lasts for the
  session. A mod cannot write settings, so it cannot save the level the way
  the Alt+P picker does.
- **A subagent's level shows once it has made a model request.** Neither the
  session's list of agents nor a subagent's start says what effort it runs at,
  so the plugin learns it from the agent's first request, a moment after it
  starts. An agent started before the plugin loaded shows `—` until its next
  request.
- **The tasks list does not show the levels.** The plugin API draws no part of
  it, so the levels are on the Agent calls' rows and in the footer instead.
- **The keys change only the agent in view.** To step another agent, open its
  transcript from the tasks list.
- **Ultracode is not a step.** It is a separate on/off switch that works at
  any level (`/effort ultracode on`), and the plugin API exposes no way to
  switch it.

## Develop

```sh
claude plugin validate .
claude plugin test .
tsc -p .
```

Claude Code writes the API declarations an editor and `tsc` type the mod
against into `.claude-plugin/types` each time it loads the folder. They are
generated per Claude Code build and are not committed.

## Privacy

effort-cycle collects no personal data. It reads Claude Code's own settings
and the session's model and agents, keeps each agent's effort level in session state
on your machine, and sends nothing to any server: no telemetry, no network
requests. Nothing is kept after the session ends.

## License

MIT
