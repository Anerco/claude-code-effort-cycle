#!/usr/bin/env python3
"""Draws each subagent's row in Claude Code's tasks list, as a `subagentStatusLine` command.

In ~/.claude/settings.json:

    "subagentStatusLine": { "type": "command", "command": "python3 ~/.claude/subagent-rows/rows.py" }

Claude Code runs it every five seconds while the session has subagents, with the rows' context as JSON
on stdin, and draws each line it prints, `{"id": "<agent id>", "content": "<text>"}`, in place of that
agent's row. A row reads the agent's name (the Agent call's description), then what each plugin left
for that agent, then what it is doing (its progress summary), then, dim, how long it has run and its
tokens as Claude Code's own row shows them, joined by ` · `:

    Fix the parser · Opus 5.5 ▰▰▰▱▱ high · ⎇4 ahead 3 files · Reading failing note test · 53m 11s · ↓ 499.8k tokens

A row too wide for the list loses its tokens, then its time, then is cut in its activity, then in its
name, then loses plugins' parts from the end. The time shows only while the agent runs: the context
gives when an agent started, not when it ended.

Plugins leave their parts in ~/.claude/subagent-rows/sessions/<session id>/<plugin>.json, one file
each, `{"order": 10, "agents": {"<agent id>": "<text>"}}`; the parts join by `order`, then by file
name, and may carry ANSI colours. A session's folder is deleted once nothing in it has changed for a
week. The script knows no plugin by name.
"""

import json
import re
import shutil
import sys
import time
import unicodedata
from pathlib import Path

SESSIONS = Path.home() / ".claude" / "subagent-rows" / "sessions"
SEP = " · "
KEEP_SECONDS = 7 * 24 * 3600
# The fewest cells of an activity worth showing; below this it goes whole.
MIN_ACTIVITY = 8
# The fewest cells the name keeps before parts are dropped from the end.
MIN_NAME = 8
ANSI = re.compile(r"\x1b\[[0-9;]*m")
DIM, UNDIM = "\x1b[2m", "\x1b[22m"
# The statuses whose time still runs.
RUNNING = ("running", "pending")


def cells(text):
    """The cells a text takes on screen: its colours none, a wide character two."""
    plain = ANSI.sub("", text)
    return sum(2 if unicodedata.east_asian_width(c) in "WF" else 1 for c in plain)


def cut(text, width):
    """A plain text in at most `width` cells, ending in … when cut."""
    if cells(text) <= width:
        return text
    out, used = "", 0
    for c in text:
        w = 2 if unicodedata.east_asian_width(c) in "WF" else 1
        if used + w > width - 1:
            break
        out, used = out + c, used + w
    return out.rstrip() + "…" if width > 0 else ""


def elapsed(ms):
    """A duration as Claude Code writes one: 12s, 53m 11s, 1h 4m 2s, 2d 3h 0m."""
    if ms < 60000:
        return f"{int(ms // 1000)}s"
    d, h, m = int(ms // 86400000), int(ms % 86400000 // 3600000), int(ms % 3600000 // 60000)
    s = round(ms % 60000 / 1000)
    if s == 60:
        s, m = 0, m + 1
    if m == 60:
        m, h = 0, h + 1
    if h == 24:
        h, d = 0, d + 1
    if d:
        return f"{d}d {h}h {m}m"
    if h:
        return f"{h}h {m}m {s}s"
    return f"{m}m {s}s"


def tokens(count):
    """A token count as Claude Code writes one: 523, 1.0k, 499.8k, 1.2m."""
    if count < 1000:
        return str(count)
    # The smallest unit that keeps it under 1000 once rounded: 999,960 is 1.0m, not 1000.0k.
    for unit, letter in ((1e3, "k"), (1e6, "m"), (1e9, "b"), (1e12, "t")):
        shown = round(count / unit, 1)
        if shown < 1000 or letter == "t":
            return f"{shown:.1f}{letter}"


def stats(task, now_ms):
    """The row's time and tokens, each a choice the row may drop: all of them, the time alone, none."""
    ran = elapsed(max(0, now_ms - task["startTime"])) if task.get("status") in RUNNING and task.get("startTime") else ""
    count = task.get("tokenCount") or 0
    used = f"↓ {tokens(count)} tokens" if count > 0 else ""
    both = SEP.join(p for p in (ran, used) if p)
    return [c for c in dict.fromkeys([both, ran, ""])]


def fragments(session_id):
    """Each plugin's parts for this session, in order: {agent id: text} per plugin."""
    folder = SESSIONS / session_id
    found = []
    for path in sorted(folder.glob("*.json")) if folder.is_dir() else []:
        try:
            data = json.loads(path.read_text())
            agents = data.get("agents")
            if isinstance(agents, dict):
                found.append((float(data.get("order", 0)), path.name, agents))
        except (OSError, ValueError, TypeError):
            continue  # A plugin writing it just now; its part shows at the next run.
    return [agents for _, _, agents in sorted(found, key=lambda f: (f[0], f[1]))]


def row(name, parts, activity, width, tail=("",)):
    """The row's text in `width` cells: its tail (time and tokens, dim) shortened first, through the choices
    given, then the activity cut, then the name, then parts dropped from the end."""
    parts = [p for p in parts if p]
    for end in tail:
        if not end:
            break
        whole = SEP.join([name, *parts, *([activity] if activity else []), f"{DIM}{end}{UNDIM}"])
        if cells(whole) <= width:
            return whole
    fixed = cells(SEP.join([name, *parts]))
    if activity:
        room = width - fixed - len(SEP)
        if room >= MIN_ACTIVITY:
            return SEP.join([name, *parts, cut(activity, room)])
    while parts and width - (fixed - cells(name)) < MIN_NAME:
        parts.pop()
        fixed = cells(SEP.join([name, *parts]))
    return SEP.join([cut(name, max(0, width - (fixed - cells(name)))), *parts])


def prune(current):
    """Deletes the folders of sessions nothing has written to for a week."""
    if not SESSIONS.is_dir():
        return
    now = time.time()
    for folder in SESSIONS.iterdir():
        if folder.name == current or not folder.is_dir():
            continue
        try:
            newest = max([folder.stat().st_mtime, *(f.stat().st_mtime for f in folder.iterdir())])
            if now - newest > KEEP_SECONDS:
                shutil.rmtree(folder, ignore_errors=True)
        except OSError:
            continue


def main():
    context = json.load(sys.stdin)
    session_id = str(context.get("session_id", ""))
    width = int(context.get("columns") or 80)
    plugins = fragments(session_id) if session_id else []
    now_ms = time.time() * 1000
    for task in context.get("tasks", []):
        name = task.get("description") or task.get("name") or task.get("type") or "agent"
        label = task.get("label") or ""
        activity = "" if label == name else label
        parts = [str(agents[task["id"]]) for agents in plugins if task["id"] in agents]
        content = row(name, parts, activity, width, stats(task, now_ms))
        print(json.dumps({"id": task["id"], "content": content}, ensure_ascii=False))
    prune(session_id)


if __name__ == "__main__":
    main()
