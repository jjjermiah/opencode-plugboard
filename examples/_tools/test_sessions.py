#!/usr/bin/env python3
"""Checks for `sessions.py` against a mocked OpenCode API: which sessions it may delete, and which it must not.

  python3 examples/_tools/test_sessions.py

The regression this pins: a foreign session started under a request (or a fork) carries a copy of the
parent's metadata, so `metadata.plugboard.app` alone must never be enough to delete it. A leaf foreign
child of an owned request must survive both `delete --all` and being named on the command line.
"""
import importlib.util
import io
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path

TOOL = Path(__file__).with_name("sessions.py")
APP = "app"


def load_tool():
    spec = importlib.util.spec_from_file_location("sessions_tool", TOOL)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Tool(unittest.TestCase):
    def setUp(self):
        self.tool = load_tool()
        app = APP
        plugboard = lambda **extra: {"plugboard": {"app": app, **extra}}
        clock = 1_700_000_000_000

        def session(sid, **fields):
            nonlocal clock
            clock += 60_000
            return {"id": sid, "time": {"created": clock, "updated": clock}, **fields}

        self.sessions = [
            # The app's anchor: never deleted.
            session("anchor-1", metadata=plugboard(anchor=True)),
            # An owned request with a child someone started under it, which inherited the request's metadata.
            session("req-1", parentID="anchor-1", metadata=plugboard(requestID="r1", model="m")),
            session("foreign-1", parentID="req-1", metadata=plugboard(requestID="r1", model="m")),
            # An owned request with no children: deletable.
            session("req-2", parentID="anchor-1", metadata=plugboard(requestID="r2", model="m")),
            # The plugin's own request, but top-level: ownership is not provable here.
            session("top-1", metadata=plugboard(requestID="r3", model="m")),
            # A fork of req-2: top-level, and it carries a copy of req-2's metadata.
            session("fork-1", metadata=plugboard(requestID="r2", model="m"), fork={"sessionID": "req-2", "boundary": "b"}),
        ]
        self.removed = []
        self.tool.api = self.fake_api

    def fake_api(self, *args):
        params = [args[i + 1] for i, arg in enumerate(args) if arg == "--param"]
        if args[0] == "session.list":
            parent = next((p.split("=", 1)[1] for p in params if p.startswith("parentID=")), None)
            if parent is not None:
                return {"data": [s for s in self.sessions if s.get("parentID") == parent][:1]}
            return {"data": list(self.sessions), "cursor": {}}
        if args[0] == "session.remove":
            victim = params[0].split("=", 1)[1]
            doomed, changed = {victim}, True
            while changed:  # the host deletes the session's children with it
                changed = False
                for s in self.sessions:
                    if s.get("parentID") in doomed and s["id"] not in doomed:
                        doomed.add(s["id"])
                        changed = True
            self.removed.extend(sorted(doomed))
            self.sessions = [s for s in self.sessions if s["id"] not in doomed]
            return {}
        raise AssertionError(f"unexpected api call: {args}")

    def run_tool(self, *argv):
        sys.argv = ["sessions.py", *argv, "--app", APP]
        out = io.StringIO()
        with redirect_stdout(out):
            self.tool.main()
        return out.getvalue()

    def alive(self):
        return sorted(s["id"] for s in self.sessions)

    def test_delete_all_removes_only_provably_owned_leaf_requests(self):
        self.run_tool("delete", "--all")
        self.assertEqual(self.removed, ["req-2"])
        self.assertEqual(self.alive(), ["anchor-1", "foreign-1", "fork-1", "req-1", "top-1"])

    def test_a_leaf_foreign_child_is_never_deleted_even_by_name(self):
        with self.assertRaises(SystemExit) as raised:
            self.run_tool("delete", "foreign-1")
        self.assertIn("not provably owned", str(raised.exception.code))
        self.assertEqual(self.removed, [])
        self.assertIn("foreign-1", self.alive())

    def test_naming_a_foreign_child_and_a_leaf_removes_nothing(self):
        with self.assertRaises(SystemExit):
            self.run_tool("delete", "foreign-1", "req-2")
        self.assertEqual(self.removed, [])

    def test_a_fork_a_parent_a_top_level_request_and_an_anchor_are_refused(self):
        for victim, expected in [
            ("fork-1", "a fork"),
            ("req-1", "a parent"),
            ("top-1", "top-level"),
            ("anchor-1", "an anchor"),
        ]:
            with self.subTest(victim=victim):
                with self.assertRaises(SystemExit) as raised:
                    self.run_tool("delete", victim)
                self.assertIn(expected, str(raised.exception.code))
        self.assertEqual(self.removed, [])

    def test_dry_run_reports_the_same_set_and_removes_nothing(self):
        out = self.run_tool("delete", "--all", "--dry-run")
        self.assertIn("would delete req-2", out)
        self.assertNotIn("would delete foreign-1", out)
        self.assertEqual(self.removed, [])

    def test_list_marks_structural_keeps_and_says_the_parent_check_is_a_delete_time_query(self):
        out = self.run_tool("list")
        self.assertIn("[keep: an anchor", out)  # anchor-1
        self.assertIn("[keep: not provably owned", out)  # foreign-1 and top-1
        self.assertIn("[keep: a fork", out)  # fork-1
        self.assertIn("delete --dry-run also checks child sessions", out)
        self.assertIn("req-2 ", out)  # an owned leaf: no mark


if __name__ == "__main__":
    unittest.main(verbosity=2)
