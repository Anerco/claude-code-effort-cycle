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
- Point at the footer's label and a **‹** and a **›** appear around the meter:
  click **‹** to step down and **›** to step up, exactly as Alt+Shift+E and
  Alt+E do, for the agent the footer shows. Their cells stay blank while the
  pointer is elsewhere, and the level's word keeps a fixed width, so nothing
  moves as they appear or as the level changes:

  ```
  not hovered:  Opus 5.5   ▰▰▰▱▱ high
  hovered:      Opus 5.5 ‹ ▰▰▰▱▱ high   ›
  ```

  Every click is one step, quick clicks included, and nothing gets selected or
  copied. Each caret takes a click on itself or the cell either side of it.
- A line under each Agent call in the transcript shows the level of the agent
  it started.
- Each subagent's row in the tasks list under the prompt shows its model and
  level too, as the footer writes them:
  `Fix the parser · Opus 5.5 ▰▰▰▱▱ high · Reading the failing test`
  (see [Levels in the tasks list](#levels-in-the-tasks-list); it needs
  `python3`). Claude Code redraws those rows every five seconds; an optional
  toggle makes a row follow a press in about 0.4 s instead.

![Alt+E steps the effort meter up to max, a light sweeps the bar while Claude works, Alt+Shift+E steps back down](demo.gif)

Each agent's level is its own and applies to that agent's next model requests.
A subagent starts at the level Claude Code gives it (its definition's
`effort`, else the main thread's), which the plugin reads off the subagent's
first model request; until then its meter is empty (`—`), and a press or a
click leaves it and says `wait`. Its model shows from the moment it starts:
`Explore · Opus 5.5 ▱▱▱▱▱ —`. Changing effort Claude Code's way (`/effort`,
the Alt+P picker) takes over again from the next request, for the main thread
and for any subagent whose level Claude Code changes with it.

With the session also open on another surface over Remote Control (Claude
Code Desktop), each surface follows its own view: the keys and that surface's
‹ › step the agent that surface is viewing. The ‹ › are drawn wherever the
footer is: the terminal and the desktop.

What it hooks: the session's start, to tell the tasks list's command where
the plugin's script is; each model request, the main thread's and every
subagent's, to read its effort level and set the one picked for that agent;
each subagent's
start, to tie the Agent call to the agent it started and note the model it
runs on; the `/effort` and `/model` commands, which it lets run unchanged and
only watches afterwards to drop its own level and redraw the footer; the
footer itself, to draw the meter and its ‹ ›; the ‹ ›'s clicks, to step the
agent the footer shows, and a ‹ › that fails to load, to draw that surface's
footer without them; the Agent calls' rows, to add the line under them; and
the band above the prompt, which says whose transcript is in view and where
two hidden buttons take the keys, leaving whatever other plugins and Claude
Code show there in place. It reads your settings and the session's list of
agents and nothing else, sends nothing anywhere, and keeps its state in the
session, save the levels it leaves for the tasks list's rows. It sets one
environment variable, `EFFORT_CYCLE_ROWS`, to the path of its own
`subagent-rows/rows.py`, which the commands Claude Code starts inherit. With
**Tasks list rows: update at once** on, it also runs a short
`python3` process on each change, which resizes the terminal and does nothing
else.

Mods (plugins of function hooks) are an early-access Claude Code API that
changes between releases. This one is built and tested against Claude Code
2.1.291.

## Install

1. Install it from the [anerco marketplace](https://github.com/Anerco/plugins), in Claude Code:

   ```
   /plugin marketplace add Anerco/plugins
   /plugin install effort-cycle@anerco
   ```

   Or, to work on it, clone the repo and load the folder with
   `claude --plugin-dir <folder>`, or in every session through
   `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`.

   That is all the tasks list's rows need: the plugin brings their setting
   with it ([Levels in the tasks list](#levels-in-the-tasks-list)).

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

## Levels in the tasks list

A plugin cannot draw in the tasks list, but Claude Code draws its subagent
rows from a command's output when settings name one as `subagentStatusLine`,
and a plugin may bring that setting with it. This one does, in its
`settings.json`, which Claude Code applies while the plugin is enabled, so
installing the plugin is all it takes. The command runs the plugin's own
`subagent-rows/rows.py`, which needs `python3` on your `PATH`: on macOS the
one that comes with the Xcode command line tools (`xcode-select --install`)
or Homebrew's will do, as will any Python 3 on Linux. It uses nothing outside
Python's standard library.

Each row then reads the Agent call's description, the agent's model and level
as the footer writes them, in the footer's colors (the model's name turns red
at max), what it is doing, and, dim, how long it has run and its tokens, as
Claude Code's own row shows them:

```
◯ Fix the parser · Opus 5.5 ▰▰▰▱▱ high · Reading failing note test · 53m 11s · ↓ 499.8k tokens
◯ Find the config · Sonnet 5.5 ▰▰▱▱▱ medium · Searching settings · 2m 4s · ↓ 31.2k tokens
◯ Audit the tests · Opus 5.5 ▰▰▰▰▰ max · Running the suite · 41s · ↓ 12.9k tokens
```

The list takes no clicks, so its rows have no ‹ ›: step an agent from its
transcript's footer. A row too wide for the list drops its tokens, then its
time, then is cut in its activity. The time shows only while the agent runs:
the command is told when an agent started, not when it ended. Claude Code runs
the command every five seconds while there are subagents, so a row follows an
Alt+E press or a click within that, or in about 0.4 s with
[Rows that follow at once](#rows-that-follow-at-once) on. The main thread has
no row there, and its level stays in the footer.

Claude Code puts no `${CLAUDE_PLUGIN_ROOT}` into a plugin's settings and runs
the command in the session's folder, and the plugin's folder changes with
each version, so the setting cannot name the script's path. The plugin's
setting is

```json
"subagentStatusLine": { "type": "command", "command": "[ -z \"$EFFORT_CYCLE_ROWS\" ] || exec python3 -I -S \"$EFFORT_CYCLE_ROWS\"" }
```

and the plugin sets `EFFORT_CYCLE_ROWS` to its own `rows.py` as the session
starts. Until it has, the command prints nothing and the rows stay Claude
Code's own.

A `subagentStatusLine` in your own settings wins over the plugin's: plugin
settings are the lowest layer, under the user, project and local files. The
plugin still writes the levels while yours is in effect, so a command of your
own can show them too, or run a copy of `rows.py` kept anywhere:

```json
"subagentStatusLine": { "type": "command", "command": "python3 ~/.claude/subagent-rows/rows.py" }
```

That is the setting this README had you add before 0.2.1. If it is in your
`~/.claude/settings.json`, remove it, and the file
`~/.claude/subagent-rows/rows.py` with it, and the plugin's own script takes
over, updated with the plugin. Leave the `sessions` folder beside it: the
plugin writes there.

While a `subagentStatusLine` is in effect, the plugin's or yours, the plugin
writes each subagent's model and level
to `~/.claude/subagent-rows/sessions/<session id>/effort-cycle.json` as
`{"order": 10, "agents": {"<agent id>": "<text>"}}`. The script joins every
file in a session's folder by `order`, so another plugin can add its own part
of the rows the same way, and it deletes a session's folder once nothing in it
has changed for a week.

The file is written when an agent starts, with its model beside the footer's
empty meter (`Opus 5.5 ▱▱▱▱▱ —`), and whenever an agent's level changes.
Claude Code reruns the command 300 ms after an agent starts, so a new row
shows its model from its first draw, and its level once the agent's first
model request has said it, a moment later.

### Rows that follow at once

Claude Code reruns the `subagentStatusLine` command on a fixed five-second
timer that no setting changes, so a row lags a press by anything up to five
seconds. It also reruns it 300 ms after the terminal's width changes. The
`/config` toggle **Tasks list rows: update at once**, off by default, uses
that: each time the plugin writes a changed level, it runs a short `python3`
process that narrows the terminal by one column and restores it 5 ms later,
and Claude Code redraws the row about 0.36 s after the press.

Measured with Claude Code 2.1.291 in tmux on Linux (WSL2), from Alt+E to the
row showing the new level:

| | view | fastest | median | slowest | presses |
| --- | --- | --- | --- | --- | --- |
| off | fullscreen | 1.4 s | 3.6 s | 4.5 s | 12 |
| on | fullscreen | 0.35 s | 0.36 s | 0.37 s | 20 |
| off | default | 0.1 s | 1.6 s | 4.2 s | 10 |
| on | default | 0.35 s | 0.36 s | 0.37 s | 12 |

Off, a row waits for the next tick of the five-second timer, so any wait
from none to five seconds is as likely as any other; on, every press in
these runs showed within 0.37 s.

What it costs, and what to know:

- **Two repaints per nudge.** Claude Code redraws the whole screen at the
  narrower width and again at the real one.
- **A one-column flicker.** Claude Code usually paints one frame at the
  narrower width: for about 13 ms everything aligned to the right edge (the
  footer's model and level, a line that fills the width) sits one column to
  the left, then moves back. It showed in 15 of 15 presses in the fullscreen
  view and 9 of 10 in the default one. The 5 ms between the two steps is what
  makes Claude Code see the narrower width at all: with no pause it missed it
  3 times in 8.
- **A burst of presses makes one nudge.** A change within 250 ms of the last
  nudge rides on it: Claude Code's rerun reads the file after it anyway.
- **It relies on Claude Code's internals, not on the plugin API.** The
  five-second timer and the rerun after a width change are how 2.1.291
  schedules the command, and a later release may change either. If it stops
  working, rows follow at Claude Code's own pace again; nothing else breaks.
- **It needs `python3` and a terminal.** In Claude Code Desktop, on a remote
  surface or in a headless run there is no terminal to nudge, and it does
  nothing; without `python3` it stops trying for the session. A resize you
  make within those 5 ms wins over its restore, and the terminal is never
  left narrowed, even if the plugin reloads mid-nudge.
- **Tested only in tmux, on Linux.** In both the fullscreen view and the
  default one (`/tui default`), where 22 nudges left nothing reprinted in the
  scrollback. Not yet tried in Windows Terminal, iTerm2, Ghostty or other
  terminals directly, or with a long transcript.

## Settings

`/config` lists five toggles, **Effort keys: include low** through **include
max**, all on by default. The keys and the footer's ‹ › step only through the
levels that are on, for every model.

A sixth, **Tasks list rows: update at once**, off by default, makes the tasks
list's rows follow a change in about 0.4 s instead of up to five seconds, at
the costs described under [Rows that follow at once](#rows-that-follow-at-once).

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
  starts; its model it learns from the start. An agent started before the
  plugin loaded shows `—`, and no model, until its next request.
- **The tasks list shows the levels only through a command.** The plugin API
  draws no part of it, so its rows come from the `subagentStatusLine` command
  the plugin brings ([Levels in the tasks list](#levels-in-the-tasks-list)),
  which needs `python3`, and follow a press within five seconds, or about
  0.4 s with [Rows that follow at once](#rows-that-follow-at-once) on. A
  `subagentStatusLine` of your own replaces the plugin's. The command is a
  POSIX shell line, so on Windows it runs only where Claude Code runs such
  commands through Git Bash.
- **The keys and the ‹ › change only the agent in view.** To step another
  agent, open its transcript from the tasks list.
- **The ‹ › need the pointer.** They show while the pointer is over the
  footer's label, so they work where Claude Code gets mouse events from the
  terminal, as in its fullscreen view; inside tmux that takes
  `set -g mouse on`. Elsewhere their cells stay blank, and the keys still step.
  They take no key: from the keyboard, Alt+E and Alt+Shift+E.
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
requests. For the tasks list's rows it also writes each subagent's model and
level to a file under `~/.claude/subagent-rows`, which the script deletes a week
after the session last wrote it, and sets `EFFORT_CYCLE_ROWS` to its script's
path in Claude Code's environment; otherwise nothing is kept after the session
ends.

## License

MIT
