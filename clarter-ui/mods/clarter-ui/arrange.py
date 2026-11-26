#!/usr/bin/env python3
# Moves tabs between Herdr.app spaces: arrange.py '[{"tab": "tb…", "to": "sp…"}, …]'
# Herdr has no command for it, so this edits the app's layout doc on herdr-core, as herdr-task does.
# A space left without tabs by a move gets the Clarter UI placeholder tab (the app can't show an empty
# space), unless the move merged it into another space of its folder; those merge under the folder's name.
import itertools, json, os, secrets, subprocess, sys, time

CORE = os.path.expanduser("~/.local/bin/herdr-core")
DOC = "herdr-app"


class Core:
    def __init__(self):
        self.proc = subprocess.Popen([CORE, "connect"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        self.ids = itertools.count(1)
        self.call("hello", {})

    def call(self, method, params):
        request_id = next(self.ids)
        self.proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}) + "\n")
        self.proc.stdin.flush()
        for line in self.proc.stdout:
            msg = json.loads(line)
            if msg.get("id") == request_id:
                if "error" in msg:
                    raise RuntimeError(f'{method}: {msg["error"]}')
                return msg["result"]
        raise RuntimeError(f"{method}: connection closed")


def apply(layout, moves):
    spaces = {s["id"]: s for s in layout["spaces"]}
    merged, moved = set(), 0
    for m in moves:
        source = next((s for s in layout["spaces"] if any(t["id"] == m["tab"] for t in s["tabs"])), None)
        target = spaces.get(m["to"])
        if not source or not target or source is target or source.get("machine") != target.get("machine"):
            continue
        tab = next(t for t in source["tabs"] if t["id"] == m["tab"])
        source["tabs"].remove(tab)
        if source.get("name", "").startswith("⏰") and not tab.get("name"):
            tab["name"] = source["name"]  # herdr-task finds a previous run's tab by this name to close it
        target["tabs"].append(tab)
        if source.get("folder", "").rstrip("/") == target.get("folder", "").rstrip("/"):
            target["name"] = os.path.basename(target["folder"].rstrip("/"))
            merged.add(source["id"])
        moved += 1
    layout["spaces"] = [s for s in layout["spaces"] if s["tabs"] or s["id"] not in merged]
    for space in layout["spaces"]:
        if not space["tabs"]:
            space["tabs"].append(placeholder())
    return moved


def placeholder():
    # The tab mods/clarter-ui/empty.js keepSpace() opens; the sidebar finds it by this name.
    tab = "tb" + secrets.token_hex(16)
    block = {"type": "block", "id": "p" + secrets.token_hex(16), "content": {"mod": "clarter-ui", "props": {"role": "empty"}}}
    return {"id": tab, "name": "No sessions", "root": {"type": "row", "id": tab, "children": [block]}}


def main():
    moves = json.loads(sys.argv[1])
    core = Core()
    for _ in range(10):
        doc = core.call("doc.get", {"name": DOC})
        layout = doc.get("value") or {"spaces": []}
        moved = apply(layout, moves)
        if not moved:
            break
        try:
            core.call("doc.set", {"name": DOC, "value": layout, "version": doc["version"]})
            break
        except RuntimeError:
            time.sleep(0.2)
    print(json.dumps({"moved": moved}))


main()
