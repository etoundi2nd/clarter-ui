#!/usr/bin/env python3
# From Over9k (github.com/herunan/herdr-over9k, MIT), writing to its own cache.
# The pull requests a Claude Code session created or worked on, and each one's
# state and CI, for the PR chip on agent rows (main.js prChip).
#   argv: transcripts (~/.claude/projects/<folder>/<session>.jsonl)
#   prints {transcript: [{repo, number, score, url, title, state, draft, review, ci}], ...}
#     best first; state OPEN | MERGED | CLOSED, ci pass | fail | pending | null
# A PR counts when Claude Code linked it to the session (a pr-link entry), the user
# pasted its link, a subagent was handed its link, or a Bash call ran
# `gh pr <create|view|review|checks|diff|comment|edit|ready|merge|checkout> <n|link>`
# or `gh api .../pulls/<n>`. Bare numbers belong to the repo of the folder the call ran in.
# Transcripts are read incrementally (offset kept in ~/.cache/clarter-ui/prs/), GitHub is
# asked through gh at most every OPEN_TTL s per open PR. Python 3, standard library.
import concurrent.futures, hashlib, json, os, re, subprocess, sys, time

HOME = os.path.expanduser("~")
CACHE = os.path.join(HOME, ".cache", "clarter-ui", "prs")
STATUS = os.path.join(CACHE, "status.json")
OPEN_TTL = 60
DONE_TTL = 3600
SCORE = {"create": 100, "linked": 50, "link": 20, "review": 5, "use": 1}

URL = re.compile(r"https://github\.com/([\w.-]+/[\w.-]+)/pull/(\d+)")
GH_PR = re.compile(r"\bgh\s+pr\s+(create|view|review|checks|diff|comment|edit|ready|merge|checkout|close|reopen)\b([^\n|;&]*)")
GH_API = re.compile(r"\bgh\s+api\b[^\n|;&]*?repos/([\w.-]+/[\w.-]+)/pulls/(\d+)")
REPO_FLAG = re.compile(r"(?:--repo|-R)[ =]([\w.-]+/[\w.-]+)")
NUMBER = re.compile(r"(?:^|\s)#?(\d{2,7})(?=\s|$)")
REVIEWING = {"review", "comment", "diff", "checks", "merge", "checkout", "edit", "ready", "close", "reopen"}

_slugs = {}


def slug_of(cwd):
    if not cwd:
        return None
    if cwd not in _slugs:
        try:
            url = subprocess.run(["git", "-C", cwd, "remote", "get-url", "origin"], capture_output=True, text=True, timeout=3).stdout.strip()
        except Exception:
            url = ""
        m = re.search(r"github\.com[:/]+([^/]+/[^/]+?)(?:\.git)?/?$", url)
        _slugs[cwd] = m.group(1) if m else None
    return _slugs[cwd]


def texts(content):
    if isinstance(content, str):
        return [content]
    out = []
    for c in content or []:
        if isinstance(c, dict):
            if c.get("type") == "text":
                out.append(c.get("text") or "")
            elif c.get("type") == "tool_result":
                out.extend(texts(c.get("content")))
    return out


def scan(path, state):
    """Adds the refs in the transcript past state['offset'] to state['refs']."""
    refs, creates, linked = state["refs"], state.setdefault("creates", {}), state.setdefault("linked", [])

    def add(repo, number, how):
        if not repo or not number:
            return
        key = f"{repo}#{int(number)}"
        refs[key] = refs.get(key, 0) + SCORE[how]

    with open(path, "rb") as f:
        f.seek(state["offset"])
        data = f.read()
    end = data.rfind(b"\n") + 1  # a line still being written waits for the next look
    for raw in data[:end].split(b"\n"):
        if not raw.strip() or (b"github.com" not in raw and b"gh " not in raw and b"tool_result" not in raw and b"pr-link" not in raw):
            continue
        try:
            j = json.loads(raw)
        except Exception:
            continue
        msg = j.get("message") or {}
        content = msg.get("content")
        if j.get("type") == "pr-link":
            key = f'{j.get("prRepository")}#{j.get("prNumber")}'
            if key not in linked:
                linked.append(key)
                add(j.get("prRepository"), j.get("prNumber"), "linked")
        elif j.get("type") == "user":
            if isinstance(content, list) and any(isinstance(c, dict) and c.get("type") == "tool_result" for c in content):
                for c in content:
                    if isinstance(c, dict) and c.get("tool_use_id") in creates:
                        creates.pop(c["tool_use_id"])
                        for m in URL.finditer("\n".join(texts([c]))):
                            add(m.group(1), m.group(2), "create")
            elif not j.get("isMeta"):
                for t in texts(content):
                    if t.startswith("<local-command") or t.startswith("<command-message"):
                        continue
                    for m in URL.finditer(t):
                        add(m.group(1), m.group(2), "link")
        elif j.get("type") == "assistant" and isinstance(content, list):
            for c in content:
                if not isinstance(c, dict) or c.get("type") != "tool_use":
                    continue
                if c.get("name") in ("Agent", "Task"):
                    for m in URL.finditer((c.get("input") or {}).get("prompt") or ""):
                        add(m.group(1), m.group(2), "review")
                if c.get("name") != "Bash":
                    continue
                cmd = (c.get("input") or {}).get("command") or ""
                for m in GH_API.finditer(cmd):
                    add(m.group(1), m.group(2), "use")
                for m in GH_PR.finditer(cmd):
                    verb, rest = m.group(1), m.group(2)
                    if verb == "create":
                        creates[c.get("id")] = True
                        continue
                    link = URL.search(rest)
                    if link:
                        add(link.group(1), link.group(2), "review" if verb in REVIEWING else "use")
                        continue
                    n = NUMBER.search(rest)
                    if n:
                        flag = REPO_FLAG.search(rest)
                        add(flag.group(1) if flag else slug_of(j.get("cwd")), n.group(1), "review" if verb in REVIEWING else "use")
    state["offset"] += end


def refs_of(path):
    cache = os.path.join(CACHE, hashlib.sha1(path.encode()).hexdigest()[:16] + ".json")
    try:
        state = json.load(open(cache))
        size = os.path.getsize(path)
        if state.get("path") != path or state.get("offset", 0) > size:
            raise ValueError
    except Exception:
        state = {"path": path, "offset": 0, "refs": {}}
    before = state["offset"]
    scan(path, state)
    if state["offset"] != before:
        tmp = cache + ".tmp"
        with open(tmp, "w") as f:
            json.dump(state, f)
        os.replace(tmp, cache)
    return state["refs"]


def ci_of(rollup):
    states = []
    for c in rollup or []:
        if c.get("__typename") == "StatusContext":
            states.append({"SUCCESS": "pass", "PENDING": "pending", "EXPECTED": "pending"}.get(c.get("state"), "fail"))
        elif c.get("status") != "COMPLETED":
            states.append("pending")
        else:
            states.append("pass" if c.get("conclusion") in ("SUCCESS", "NEUTRAL", "SKIPPED") else "fail")
    if not states:
        return None
    return "fail" if "fail" in states else "pending" if "pending" in states else "pass"


def fetch(key):
    repo, number = key.split("#")
    r = subprocess.run(["gh", "pr", "view", number, "--repo", repo, "--json", "url,title,state,isDraft,reviewDecision,statusCheckRollup"],
                       capture_output=True, text=True, timeout=20)
    if r.returncode != 0:
        return None
    d = json.loads(r.stdout)
    return {"url": d["url"], "title": d["title"], "state": d["state"], "draft": d["isDraft"], "review": d.get("reviewDecision") or None,
            "ci": ci_of(d.get("statusCheckRollup")), "at": time.time()}


def safe_fetch(key):
    try:
        return fetch(key)
    except Exception:
        return None


def main():
    os.makedirs(CACHE, exist_ok=True)
    found = {}
    for path in sys.argv[1:]:
        try:
            found[path] = refs_of(path) if os.path.isfile(path) else {}
        except Exception:
            found[path] = {}
    try:
        status = json.load(open(STATUS))
    except Exception:
        status = {}
    now = time.time()
    wanted = {k for refs in found.values() for k in refs}
    due = [k for k in wanted if not status.get(k) or now - status[k]["at"] > (OPEN_TTL if status[k]["state"] == "OPEN" else DONE_TTL)]
    if due:
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            for k, s in zip(due, pool.map(safe_fetch, due)):
                if s:
                    status[k] = s
        status = {k: v for k, v in status.items() if k in wanted or now - v["at"] < 86400}
        tmp = STATUS + ".tmp"
        with open(tmp, "w") as f:
            json.dump(status, f)
        os.replace(tmp, STATUS)
    out = {}
    for path, refs in found.items():
        rows = []
        for k, score in sorted(refs.items(), key=lambda kv: -kv[1]):
            repo, number = k.split("#")
            s = status.get(k)
            if s:
                rows.append({"repo": repo, "number": int(number), "score": score, **{x: s[x] for x in ("url", "title", "state", "draft", "review", "ci")}})
        out[path] = rows
    json.dump(out, sys.stdout, separators=(",", ":"))


main()
