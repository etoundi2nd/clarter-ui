#!/usr/bin/env python3
# Claude Code accounts on this computer, one per config dir (CLAUDE_CONFIG_DIR, else ~/.claude):
#   {"terminals": {terminal: dir}, "accounts": [{dir, open, displayName, email, org, oauth, at, limits}]}
# A terminal is matched to its account through the running claude's environment (ps -E: only
# your own processes show it). Limits are what the profile's status line last saved in usage.json.
import glob, json, os, re, subprocess, sys

HOME = os.path.expanduser("~")


def account_file(d):
    # Without CLAUDE_CONFIG_DIR, Claude Code keeps its account in ~/.claude.json, not in ~/.claude.
    return os.path.join(HOME, ".claude.json") if d == os.path.join(HOME, ".claude") else os.path.join(d, ".claude.json")


def load(path):
    try:
        return json.load(open(path))
    except Exception:
        return {}


def running():
    out = subprocess.run(["ps", "-A", "-wwE", "-o", "command="], capture_output=True, text=True, timeout=5).stdout
    found = {}
    for line in out.splitlines():
        if os.path.basename(line.split(" ", 1)[0]) != "claude":
            continue
        term = re.search(r"(?:^|\s)HC_TERMINAL_ID=(\S+)", line)
        conf = re.search(r"(?:^|\s)CLAUDE_CONFIG_DIR=(\S+)", line)
        if term:
            found[term.group(1)] = (conf.group(1) if conf else os.path.join(HOME, ".claude")).rstrip("/")
    return found


def main():
    terminals = running()
    open_dirs = set(terminals.values())
    accounts = []
    dirs = sorted({d.rstrip("/") for d in glob.glob(os.path.join(HOME, ".claude*/")) if os.path.exists(os.path.join(d, "settings.json"))} | open_dirs)
    for d in dirs:
        oauth = load(account_file(d)).get("oauthAccount") or {}
        email = oauth.get("emailAddress")
        if not email:
            continue
        usage = load(os.path.join(d, "usage.json"))
        # Over9k's optional status line saves the default account's limits in its own cache.
        if not usage and d == os.path.join(HOME, ".claude"):
            saved = load(os.path.join(HOME, ".cache", "over9k", "usage", "claude.json"))
            usage = {"at": saved.get("at"), "rate_limits": {k: v for k, v in saved.items() if k in ("five_hour", "seven_day", "seven_day_opus")} or None}
        entry = {"dir": d, "open": d in open_dirs, "displayName": oauth.get("displayName"), "email": email,
                 "org": oauth.get("organizationName"), "oauth": oauth, "at": usage.get("at"), "limits": usage.get("rate_limits")}
        # Two profiles signed in to one account are one account, with the newest limits either saved.
        same = next((a for a in accounts if a["email"] == email), None)
        if not same:
            accounts.append(entry)
            continue
        same["open"] = same["open"] or entry["open"]
        if (entry["at"] or 0) > (same["at"] or 0):
            same["at"], same["limits"] = entry["at"], entry["limits"]
    by_dir = {a["dir"]: a for a in accounts}
    for d in dirs:
        oauth = load(account_file(d)).get("oauthAccount") or {}
        match = next((a for a in accounts if a["email"] == oauth.get("emailAddress")), None)
        if match:
            by_dir.setdefault(d, match)
    json.dump({"terminals": {t: by_dir[d]["dir"] for t, d in terminals.items() if d in by_dir},
               "accounts": accounts}, sys.stdout, separators=(",", ":"))


main()
