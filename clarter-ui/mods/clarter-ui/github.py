#!/usr/bin/env python3
# GitHub facts for the Frank layout, through `gh` (Python 3, standard library):
#   github.py prs <owner/repo#n> ...   each PR's state, review, CI, conflicts, comments
#   github.py repo <folder>            the folder's GitHub URL, commits behind upstream
#   github.py involved <folder>        open PRs in that repo that involve the user
#   github.py pull <folder>            git pull --ff-only there, then forget its cached state
# Prints JSON. gh is asked at most every TTL seconds per question (cache in
# ~/.cache/clarter-ui), so the mods can poll freely.
import concurrent.futures, hashlib, json, os, re, subprocess, sys, time

CACHE = os.path.join(os.path.expanduser("~"), ".cache", "clarter-ui")
OPEN_TTL, DONE_TTL, REPO_TTL = 60, 3600, 60
FIELDS = "number,url,title,state,isDraft,reviewDecision,statusCheckRollup,mergeable,autoMergeRequest,latestReviews,reviewRequests,comments,updatedAt"


def sh(args, cwd=None, timeout=20):
    try:
        r = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=timeout)
        return r.stdout if r.returncode == 0 else None
    except Exception:
        return None


def cached(key, ttl, compute):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, hashlib.sha1(key.encode()).hexdigest()[:16] + ".json")
    try:
        hit = json.load(open(path))
        if time.time() - hit["at"] < hit.get("ttl", ttl):
            return hit["value"]
    except Exception:
        pass
    value = compute()
    if value is not None:
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            json.dump({"at": time.time(), "ttl": ttl(value) if callable(ttl) else ttl, "value": value}, f)
        os.replace(tmp, path)
    return value


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


def review_of(d):
    latest = [r for r in d.get("latestReviews") or [] if r.get("state") != "PENDING"]
    decision = d.get("reviewDecision")
    if decision == "APPROVED":
        return "approved"
    if decision == "CHANGES_REQUESTED" or any(r["state"] == "CHANGES_REQUESTED" for r in latest):
        return "changes-requested"
    if latest and latest[-1]["state"] == "DISMISSED":
        return "dismissed"
    if any(r["state"] == "COMMENTED" for r in latest):
        return "commented"
    if d.get("reviewRequests") or decision == "REVIEW_REQUIRED":
        return "review-pending"
    return None


def shape(d):
    state = d["state"]
    lifecycle = "merged" if state == "MERGED" else "closed" if state == "CLOSED" else "draft" if d.get("isDraft") \
        else "queued" if d.get("autoMergeRequest") else "open"
    latest = [r for r in d.get("latestReviews") or [] if r.get("state") != "PENDING"]
    reviewers = {(r.get("author") or {}).get("login") for r in latest} | {
        (q.get("login") or q.get("name") or q.get("slug")) for q in d.get("reviewRequests") or []}
    reviewers.discard(None)
    submitted = [r.get("submittedAt") for r in latest if r.get("submittedAt")]
    return {
        "number": d["number"], "url": d["url"], "title": d["title"], "lifecycle": lifecycle,
        "review": review_of(d), "ci": ci_of(d.get("statusCheckRollup")),
        "conflict": d.get("mergeable") == "CONFLICTING",
        "comments": len(d.get("comments") or []),
        "approvals": sum(1 for r in latest if r["state"] == "APPROVED"), "reviewers": len(reviewers),
        "updatedAt": d.get("updatedAt"), "lastReviewAt": max(submitted) if submitted else None,
    }


def pr(key):
    repo, number = key.split("#")
    def compute():
        out = sh(["gh", "pr", "view", number, "--repo", repo, "--json", FIELDS])
        return shape(json.loads(out)) if out else None
    return cached("pr:" + key, lambda v: OPEN_TTL if v["lifecycle"] in ("open", "draft", "queued") else DONE_TTL, compute)


def slug_of(url):
    m = re.search(r"github\.com[:/]([\w.-]+/[\w.-]+?)(?:\.git)?/?$", url or "")
    return m.group(1) if m else None


def repo(folder):
    def compute():
        top = (sh(["git", "rev-parse", "--show-toplevel"], cwd=folder) or "").strip()
        if not top:
            return {}
        slug = slug_of((sh(["git", "remote", "get-url", "origin"], cwd=top) or "").strip())
        behind = (sh(["git", "rev-list", "--count", "HEAD..@{u}"], cwd=top) or "").strip()
        return {"root": top, "slug": slug, "url": f"https://github.com/{slug}" if slug else None,
                "behind": int(behind) if behind.isdigit() else 0}
    return cached("repo:" + folder, REPO_TTL, compute)


def involved(folder):
    info = repo(folder)
    slug = info.get("slug")
    if not slug:
        return {"repo": None, "prs": []}
    def compute():
        out = sh(["gh", "pr", "list", "--repo", slug, "--search", "involves:@me", "--state", "open", "--limit", "20", "--json", FIELDS])
        return [shape(d) for d in json.loads(out)] if out else None
    return {"repo": slug.split("/")[-1], "url": info.get("url"), "prs": cached("involved:" + slug, OPEN_TTL, compute) or []}


def pull(folder):
    top = (sh(["git", "rev-parse", "--show-toplevel"], cwd=folder) or "").strip()
    try:
        r = subprocess.run(["git", "pull", "--ff-only"], cwd=top or folder, capture_output=True, text=True, timeout=120,
                           env={**os.environ, "GIT_TERMINAL_PROMPT": "0"})
    except Exception as e:
        return {"ok": False, "output": str(e)}
    for name in os.listdir(CACHE) if os.path.isdir(CACHE) else []:
        path = os.path.join(CACHE, name)
        try:
            if (json.load(open(path)).get("value") or {}).get("root") == top:
                os.remove(path)
        except Exception:
            pass
    lines = [l for l in (r.stdout + r.stderr).strip().splitlines() if l.strip()]
    return {"ok": r.returncode == 0, "output": "\n".join(lines[-3:])}


def main():
    mode, args = sys.argv[1], sys.argv[2:]
    if mode == "prs":
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            result = dict(zip(args, pool.map(pr, args)))
    elif mode == "pull":
        result = pull(args[0])
    elif mode == "repo":
        result = {f: repo(f) for f in args}
    else:
        result = involved(args[0])
    json.dump(result, sys.stdout, separators=(",", ":"))


main()
