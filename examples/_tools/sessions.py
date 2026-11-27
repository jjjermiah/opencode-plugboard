#!/usr/bin/env python3
"""List or delete plugboard history sessions of one app on an OpenCode server. Other apps are never touched.

  python3 examples/_tools/sessions.py list                          # sessions of the app: id, time, model, title
  python3 examples/_tools/sessions.py delete --all --dry-run        # show what would go
  python3 examples/_tools/sessions.py delete --older-than 60        # only sessions older than 60 minutes
  python3 examples/_tools/sessions.py delete ses_abc ses_def        # specific ids (refused unless they belong to the app)

Environment:
  PLUGBOARD_OC         command that runs the OpenCode CLI against the server you mean (default: opencode).
                       Use a wrapper script when the server needs its own HOME/XDG dirs; see docs/development.md.
  PLUGBOARD_DATA_ROOT  plugboard data root (default: $XDG_DATA_HOME/opencode-plugboard, else ~/.local/share/opencode-plugboard)

Options: --app NAME (default: compat). Sessions are matched on metadata.plugboard.app == NAME.
Parallel client runs share one app, so prefer --older-than or explicit ids while others are running.

Deletion follows the plugin's pruning rules as far as this API shows them: an anchor
(metadata.plugboard.anchor), a fork (its metadata is copied from the session it forked, so the app match
catches it too), and a session that has child sessions are never deleted. OpenCode deletes a session's
children with it, so a parent is kept the way the plugin's sweep keeps it. Explicit ids that are not
removable are refused rather than skipped. A child created between the check and the removal is still
taken with the parent: the server has no conditional delete.
"""
import argparse, json, os, shlex, subprocess, sys, time
from pathlib import Path

OC = shlex.split(os.environ.get("PLUGBOARD_OC", "opencode"))
DATA_ROOT = Path(os.environ.get("PLUGBOARD_DATA_ROOT") or Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local/share") / "opencode-plugboard")


def api(*args):
    r = subprocess.run([*OC, "api", *args], capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"{' '.join(OC)} api {' '.join(args)} failed: {r.stderr or r.stdout}")
    return json.loads(r.stdout) if r.stdout.strip() else {}


def app_sessions(app):
    directory = str(DATA_ROOT / app)
    out, cursor = [], None
    while True:
        args = ["session.list", "--param", f"directory={directory}", "--param", "limit=100"]
        if cursor:
            args += ["--param", f"cursor={cursor}"]
        page = api(*args)
        data = page.get("data", [])
        out += [s for s in data if s.get("metadata", {}).get("plugboard", {}).get("app") == app]
        cursor = (page.get("cursor") or {}).get("next")
        if len(data) < 100 or not cursor:
            return out


def has_children(session_id):
    return bool(api("session.list", "--param", f"parentID={session_id}", "--param", "limit=1").get("data"))


def skip_reason(app, s, check_children):
    """Why `s` must not be deleted, or None. The plugin's rules, as far as the server API shows them."""
    meta = (s.get("metadata") or {}).get("plugboard")
    if not isinstance(meta, dict) or meta.get("app") != app:
        return "not a session of this app"
    if meta.get("anchor") is True:
        return "an anchor: the parent of request sessions, never pruned"
    if s.get("fork"):
        return "a fork: it copies the metadata of the session it forked"
    if check_children and has_children(s["id"]):
        return "a parent: OpenCode deletes its child sessions with it"
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["list", "delete"])
    ap.add_argument("ids", nargs="*")
    ap.add_argument("--app", default="compat")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--older-than", type=float, help="minutes")
    ap.add_argument("--dry-run", action="store_true", help="print the sessions that would be deleted and delete nothing")
    a = ap.parse_args()
    ss = app_sessions(a.app)
    if a.cmd == "list":
        for s in ss:
            t = time.strftime("%H:%M:%S", time.localtime(s["time"]["created"] / 1000))
            keep = skip_reason(a.app, s, False)
            line = " ".join([s["id"], t, str(s["metadata"]["plugboard"].get("model")), "|", s.get("title", "")[:60]])
            print(line + (f"  [keep: {keep}]" if keep else ""))
        print(f"{len(ss)} sessions in app {a.app!r} under {DATA_ROOT / a.app}")
        return
    if a.ids:
        by = {s["id"]: s for s in ss}
        bad = [i for i in a.ids if i not in by]
        if bad:
            sys.exit(f"refusing: not sessions of app {a.app!r}: {bad}")
        blocked = [(i, skip_reason(a.app, by[i], True)) for i in a.ids]
        blocked = [(i, why) for i, why in blocked if why]
        if blocked:
            sys.exit("refusing: " + "; ".join(f"{i} is {why}" for i, why in blocked))
        victims = [by[i] for i in a.ids]
    elif a.all or a.older_than is not None:
        cutoff = time.time() * 1000 - (a.older_than or 0) * 60000
        selected = [s for s in ss if s["time"]["created"] <= cutoff]
        victims = [s for s in selected if skip_reason(a.app, s, True) is None]
        kept = len(selected) - len(victims)
        if kept:
            print(f"keeping {kept} of {len(selected)}: an anchor, a fork, or a parent")
    else:
        sys.exit("give ids, --all or --older-than N")
    if a.dry_run:
        for s in victims:
            print("would delete", s["id"], s.get("title", "")[:60])
        print(f"dry run: {len(victims)} of {len(ss)} sessions would be deleted")
        return
    for s in victims:
        api("session.remove", "--param", f"sessionID={s['id']}")
    print(f"deleted {len(victims)} of {len(ss)} sessions")


if __name__ == "__main__":
    main()
