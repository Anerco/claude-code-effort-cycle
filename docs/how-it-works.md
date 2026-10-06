# How effort-cycle works

The internals: what the plugin hooks, how the keys and the footer work, where
each level comes from, how the tasks list's rows are drawn and kept current,
and how to develop the plugin. To install and use it, see the
[README](../README.md).

- [What it hooks](#what-it-hooks)
- [The keys](#the-keys)
- [The footer](#the-footer)
- [Where each level comes from](#where-each-level-comes-from)
- [Remote Control](#remote-control)
- [Levels in the tasks list](#levels-in-the-tasks-list)
- [Rows that follow at once](#rows-that-follow-at-once)
- [Develop](#develop)

## What it hooks

| Hook | What the plugin does there |
| --- | --- |
| `session.start` | Sets `EFFORT_CYCLE_ROWS` to this version's `subagent-rows/rows.py`, for the tasks list's command. |
| `turn.step` (every model request, the main thread's and each subagent's) | Reads the level Claude Code sends. If a pick was made for that agent, sends the pick instead. |
| `agent.spawn` | Ties the Agent call to the agent it started and notes the model it runs on. |
| `command.run` for `/effort` and `/model` | Lets the command run unchanged, then drops the main thread's pick (`/effort`) or redraws the footer (`/model`). |
| `ui.render` of the footer's mode label (`SessionMode`) | Draws the model, the meter, the level's word and the ‹ ›, after Claude Code's own modes. |
| `ui.message` | Takes clicks on ‹ › and steps the agent that surface's footer shows. |
| `ui.fault` | If a ‹ › fails to load on a surface, draws that surface's footer without them. |
| `ui.render` of the band above the prompt (`AbovePrompt`) | Records whose transcript is in view, starts and stops the sweep, and holds the hidden buttons that take the keys. What other plugins and Claude Code draw there stays in place. |
| `ui.render` of Agent calls (`ToolUse`) | Adds the line with the started agent's level. |

The plugin reads your settings, `CLAUDE_CODE_EFFORT_LEVEL`, and the session's
model and list of agents. It sends nothing anywhere. It keeps its
state in the session, except the levels it writes for the tasks list's rows.
It sets one environment variable, `EFFORT_CYCLE_ROWS`, which the commands
Claude Code starts inherit. With **Tasks list rows: update at once** on, it
also runs a short `python3` process on each change, which resizes the
terminal and does nothing else.

It never runs `/effort`, which would print rows into the transcript. It sets
each agent's level on that agent's own model requests instead. The meter is
drawn as the footer's mode label rather than by a status line command, since
Claude Code reruns a status line only on its own changes.

## The keys

A mod cannot own a key, and a plugin brings no keybindings. A mod can only
borrow one of Claude Code's own keybinding actions, through a button. So two
hidden buttons in the band above the prompt take the diff panel's file-list
actions:

| Action | Default keys | Steps |
| --- | --- | --- |
| `app:diffFileListUp` | Ctrl+↑, Alt+↑ | up |
| `app:diffFileListDown` | Ctrl+↓, Alt+↓ | down |

These actions do nothing at the prompt, so the keys step with no setup, and a
draft in the prompt stays as it is. The diff panel (`/diff`, in the
fullscreen view) handles the actions itself only while its file list holds
more files than it shows (eight) and scrolls. Then the keys scroll the list
and step nothing; close the panel to step again. If you rebind the actions in
`~/.claude/keybindings.json`, the effort keys move with them.

Steps run one at a time, each from the level the last one left, so two quick
presses make two steps. The keys step only through the levels the `/config`
include toggles allow, for every model.

On macOS, Ctrl+↑ and Ctrl+↓ belong to Mission Control and Application windows
by default; turn those off in System Settings → Keyboard → Keyboard Shortcuts
→ Mission Control. Option+↑ and Option+↓ reach Claude Code as Alt+↑ and
Alt+↓ once the terminal sends Option as Meta:

| Terminal | Setting |
| --- | --- |
| Terminal.app | Settings → Profiles → Keyboard → **Use Option as Meta key** |
| iTerm2 | Settings → Profiles → Keys → **Left Option key**: **Esc+** |
| Ghostty | `macos-option-as-alt = true` |

## The footer

The footer shows the model and level of the agent in view. In a subagent's
transcript it is led by the agent's type (a teammate's name, for a teammate):
`Explore · Opus 5.5 ▰▰▱▱▱ medium`.

- **Colors.** Each level takes a theme color, so the meter follows your
  theme: low `inactive` (gray), medium `success` (green), high `warning`
  (yellow), xhigh `claude` (orange), max `error` (red). At max the model's
  name is red too and the word is bold.
- **Feedback.** The blocks a press fills or empties light for a second. A
  press past either end lights the level's word instead.
- **The sweep.** While Claude works at max, a light moves across the bar one
  block every 85 ms, then rests, one pass every 1.53 s.
- **Fixed width.** The word sits in a slot as wide as the widest level, and
  each caret's cells are kept blank while it is hidden, so nothing moves as
  the level changes or the carets appear.
- **The ‹ ›.** They show while the pointer is over the label, which needs
  mouse events from the terminal (Claude Code's fullscreen view; in tmux,
  `set -g mouse on`). Each takes three cells, a blank, the caret and a blank,
  and a click on any of them steps. A caret is a Client module
  (`hooks/caret.tsx`), so Claude Code does not count quick clicks as a double
  click and selects or copies nothing; every click is one step. Each click's
  message carries the caret's running count of presses, so a click whose
  message a later one replaced still steps. They take no key.
- **Surfaces.** The terminal and Claude Code Desktop both draw the footer and
  its ‹ ›. If a caret's module fails to load on a surface, that surface's
  footer is drawn without them until the plugin loads again.
- **Model changes.** `/model` is watched directly. Nothing tells a mod about a
  model picked with Alt+P, but the band above the prompt redraws when the
  picker closes; it notices the new model and redraws the footer.

## Where each level comes from

Each agent's level is its own and applies to that agent's next model
requests.

### The main thread

Claude Code tells a plugin a model's level only on a request. Before the first
one, the plugin resolves it as Claude Code 2.1.291 does, and as Claude Code's
own `◐ medium · /effort` shows it:

1. **`CLAUDE_CODE_EFFORT_LEVEL`**, read as Claude Code reads it. A level
   (`med` for medium) wins over every setting. A number, `unset` or `auto`
   shows as high. Anything else is ignored.
2. **Else the first settings source that gives the model a level**, highest
   precedence first: managed policy, `--settings`, local, project, user. A
   level counts in `modelSettings` under the model's name (or a dated, `[1m]`,
   Bedrock or Vertex spelling of it), or as a top-level `effortLevel`. Your
   own top-level `effortLevel` in `~/.claude/settings.json` counts only for
   models before Opus 5.5 and Sonnet 5.5, and for names that are not Claude
   model names. Later models take only a level saved for them (as `/effort`
   and Alt+P save one) or a top-level one from another source. A source Claude
   Code did not load (`--setting-sources`) is skipped. A value settings cannot
   hold (`max`, a typo) gives the model's default.
3. **Else the model's default** in Claude Code 2.1.291's catalog: medium on
   Opus 5.5 and Sonnet 5.5, xhigh on Opus 4.7, high on the rest.

From the first request on, the footer shows the level Claude Code sends. An
organization's default, the model list Anthropic's API serves and Claude
Code's server-side flags can give a model another default that a plugin
cannot see. If one does, the footer switches to it at the first request, and
a pick made before then stands.

A pick belongs to the model it was made on. Running `/effort` drops it at
once, and the footer shows the level `/effort` set. A change of level from
Claude Code on the same model, such as one made with Alt+P, drops it from the
next request. A pick lasts for the session: a plugin cannot write settings, so it
cannot save one.

### Subagents

Claude Code starts a subagent at its definition's `effort`, else the main
thread's level. Neither the session's list of agents nor a subagent's start
says which, so the plugin reads it off the subagent's first model request, a
moment after it starts. The model is known sooner, from the start.

Until that first request the meter is empty (`Explore · Opus 5.5 ▱▱▱▱▱ —`),
and a press leaves it and shows `wait`. An agent started before the plugin
loaded shows `—` and no model until its next request. The line under its
Agent call appears once its level is known.

A press while a subagent's transcript is in view sets the level its next
requests go out with, and leaves the main thread and every other agent as
they were. If Claude Code changes that subagent's level itself, the pick is
dropped, as on the main thread.

## Remote Control

With the session also open on another surface over Remote Control (Claude
Code Desktop), each surface follows its own view. The band above the prompt
records which transcript each surface shows, and the keys and that surface's
‹ › step the agent it is viewing. The ‹ › are drawn on the terminal and the
desktop. The width nudge ([Rows that follow at once](#rows-that-follow-at-once))
does nothing where no terminal draws the session.

## Levels in the tasks list

### The command

A plugin cannot draw in the tasks list. Claude Code draws its subagent rows
from a command's output when settings name one as `subagentStatusLine`, and a
plugin may bring that setting in its own `settings.json`, which Claude Code
applies beneath every settings file while the plugin is enabled. This
plugin's:

```json
"subagentStatusLine": {
  "type": "command",
  "command": "[ -z \"$EFFORT_CYCLE_ROWS\" ] || exec python3 -I -S \"$EFFORT_CYCLE_ROWS\""
}
```

The setting cannot name the script's path. Claude Code puts no
`${CLAUDE_PLUGIN_ROOT}` into a plugin's settings, gives the command no
`CLAUDE_PLUGIN_ROOT`, and runs it in the session's folder, and the plugin's
folder changes with each version. The command does inherit Claude Code's
environment, so the plugin sets `EFFORT_CYCLE_ROWS` to its own
`subagent-rows/rows.py` as the session starts, and again before it writes the
rows if it was enabled after the session started. Until then the command
prints nothing and the rows stay Claude Code's own.

`rows.py` needs `python3` on your `PATH` and nothing outside Python's
standard library; the Python 3.9 macOS ships will do. It reads its input as
bytes and writes ASCII JSON, so a locale that is not UTF-8 changes nothing.
The command is a POSIX shell line, so on Windows it runs only where Claude
Code runs such commands through Git Bash.

Claude Code runs the command every five seconds while the session has
subagents, and 300 ms after its count of agents changes, with the rows'
context as JSON on stdin. Each line the command prints,
`{"id": "<agent id>", "content": "<text>"}`, replaces that agent's row.

### What a row shows

A row joins these with ` · `: the Agent call's description, each plugin's
part, what the agent is doing, and, dim, how long it has run and its tokens,
as Claude Code's own row shows them:

```
◯ Fix the parser · Opus 5.5 ▰▰▰▱▱ high · Reading failing note test · 53m 11s · ↓ 499.8k tokens
◯ Find the config · Sonnet 5.5 ▰▰▱▱▱ medium · Searching settings · 2m 4s · ↓ 31.2k tokens
◯ Audit the tests · Opus 5.5 ▰▰▰▰▰ max · Running the suite · 41s · ↓ 12.9k tokens
```

This plugin's part is the model and level as the footer writes them, in the
footer's colors as ANSI (the model's name red at max), with no ‹ ›: the list
takes no clicks. The time shows only while the agent runs, since the context
says when an agent started, not when it ended. The main thread has no row; its
level stays in the footer.

A row too wide for the list drops its tokens, then its time. Then its
activity is cut, or dropped if fewer than eight cells would be left. Then its
name is cut, and plugins' parts are dropped from the end so the name keeps at
least eight cells.

### Your own `subagentStatusLine`

Plugin settings are the lowest layer, under the user, project and local
files, so a `subagentStatusLine` in your own settings wins over the plugin's.
The plugin still writes the levels while yours is in effect, so a command of
your own can show them too, or run a copy of `rows.py` kept anywhere:

```json
"subagentStatusLine": {
  "type": "command",
  "command": "python3 ~/.claude/subagent-rows/rows.py"
}
```

That is the setting the README had you add before 0.2.1. If it is in your
`~/.claude/settings.json`, remove it, and `~/.claude/subagent-rows/rows.py`
with it; the plugin's own script takes over and updates with the plugin.
Leave the `sessions` folder beside it: the plugin writes there.

### Row files, for other plugins

While a `subagentStatusLine` is in effect, the plugin's or yours, the plugin
writes each subagent's part of its row to

```
~/.claude/subagent-rows/sessions/<session id>/effort-cycle.json
```

as `{"order": 10, "agents": {"<agent id>": "<text>"}}`. `rows.py` knows no
plugin by name: it joins every `*.json` file in the session's folder by
`order`, then by file name, so another plugin can add its own part of the
rows the same way. A part may carry ANSI colors. The script deletes a
session's folder once nothing in it has changed for a week.

The plugin writes the file when an agent starts, with its model beside the
empty meter (`Opus 5.5 ▱▱▱▱▱ —`), and whenever an agent's level changes. With
the rerun 300 ms after an agent starts, a new row shows its model from its
first draw, and its level once the agent's first model request has said it.

## Rows that follow at once

Claude Code reruns the `subagentStatusLine` command on a fixed five-second
timer that no setting changes, so a row can lag a change by up to five
seconds. It also reruns the command 300 ms after the terminal's width
changes. The `/config` toggle **Tasks list rows: update at once**, off by
default, uses that: each time the plugin writes a changed level, it runs a
short `python3` process that narrows the terminal by one column and restores
it 5 ms later. Claude Code then redraws the row about 0.36 s after the press.

Measured with Claude Code 2.1.291 in tmux on Linux (WSL2), from a key press
to the row showing the new level:

| Toggle | View | Fastest | Median | Slowest | Presses |
| --- | --- | --- | --- | --- | --- |
| off | fullscreen | 1.4 s | 3.6 s | 4.5 s | 12 |
| on | fullscreen | 0.35 s | 0.36 s | 0.37 s | 20 |
| off | default | 0.1 s | 1.6 s | 4.2 s | 10 |
| on | default | 0.35 s | 0.36 s | 0.37 s | 12 |

Off, a row waits for the next tick of the five-second timer, so any wait from
none to five seconds is as likely as any other. On, every press in these runs
showed within 0.37 s.

What it costs, and what to know:

- **Two repaints per nudge.** Claude Code redraws the whole screen at the
  narrower width and again at the real one.
- **A one-column flicker.** Claude Code usually paints one frame at the
  narrower width: for about 13 ms everything aligned to the right edge (the
  footer's model and level, a line that fills the width) sits one column to
  the left, then moves back. It showed in 15 of 15 presses in the fullscreen
  view and 9 of 10 in the default one. The 5 ms pause is what lets Claude
  Code see the narrower width at all: with no pause it missed it 3 times in 8.
- **A burst of presses makes one nudge.** A change within 250 ms of the last
  nudge rides on it, since Claude Code's rerun reads the file after it anyway.
- **It relies on Claude Code's internals, not on the plugin API.** The
  five-second timer and the rerun after a width change are how 2.1.291
  schedules the command, and a later release may change either. If it stops
  working, rows follow at Claude Code's own pace again; nothing else breaks.
- **It needs `python3` and a terminal.** In Claude Code Desktop, on a remote
  surface or in a headless run there is no terminal to nudge, and it does
  nothing. Without `python3` it stops trying for the session.
- **It never leaves the terminal narrowed.** The resize runs in a process of
  its own that ignores the terminal's signals, so a plugin reload mid-nudge
  still restores the width. A resize you make within those 5 ms wins over the
  restore.
- **Tested only in tmux, on Linux**, in both the fullscreen view and the
  default one (`/tui default`), where 22 nudges left nothing reprinted in the
  scrollback. Not yet tried directly in Windows Terminal, iTerm2, Ghostty or
  other terminals, or with a long transcript.

## Develop

Clone the repo and load the folder with `claude --plugin-dir <folder>`, or in
every session through `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of
`~/.claude/settings.json`. Then:

```sh
claude plugin validate .
claude plugin test .
tsc -p .
```

Claude Code writes the API declarations that an editor and `tsc` type the mod
against into `.claude-plugin/types` each time it loads the folder. They are
generated per Claude Code build and are not committed.

| File | What it is |
| --- | --- |
| [`hooks/register.tsx`](../hooks/register.tsx) | The hooks: keys, levels, footer, band, Agent-call line, row files, nudge |
| [`hooks/caret.tsx`](../hooks/caret.tsx) | One footer caret, ‹ or › |
| [`hooks/register.test.ts`](../hooks/register.test.ts) | Tests, run by `claude plugin test .` |
| [`subagent-rows/rows.py`](../subagent-rows/rows.py) | The tasks list's `subagentStatusLine` command |
| [`settings.json`](../settings.json) | The plugin's `subagentStatusLine` setting |
| [`.claude-plugin/plugin.json`](../.claude-plugin/plugin.json) | The manifest and the `/config` toggles |
