#!/usr/bin/env python3
"""Draws each subagent's row in Claude Code's tasks list, as a `subagentStatusLine` command.

In ~/.claude/settings.json:

    "subagentStatusLine": { "type": "command", "command": "python3 ~/.claude/subagent-rows/rows.py" }

Claude Code runs it every five seconds while the session has subagents, with the rows' context as JSON
on stdin, and draws each line it prints, `{"id": "<agent id>", "content": "<text>"}`, in place of that
agent's row. A row reads the agent's name (the Agent call's description), then what each plugin left
for that agent, then what it is doing (its progress summary), joined by ` · ` and cut to the row's
width, its activity first:

    Fix the parser · ‹▰▰▰▱▱› high · ⎇4 ahead 3 files · Reading failing note test in chat.spec.ts

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


def row(name, parts, activity, width):
    """The row's text in `width` cells: the activity cut first, then the name, then parts dropped from the end."""
    parts = [p for p in parts if p]
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
    for task in context.get("tasks", []):
        name = task.get("description") or task.get("name") or task.get("type") or "agent"
        label = task.get("label") or ""
        activity = "" if label == name else label
        parts = [str(agents[task["id"]]) for agents in plugins if task["id"] in agents]
        print(json.dumps({"id": task["id"], "content": row(name, parts, activity, width)}, ensure_ascii=False))
    prune(session_id)


if __name__ == "__main__":
    main()
