#!/usr/bin/env python3
"""Tests for the shaping `bin/pr-status` does. Run: python3 tests/test_pr_status.py

What gh answers with is turned into the one object the band draws from, and that
turning is pure — no network and no repository. The fetches themselves, the
cache and the printing are the only parts left uncovered.
"""
import importlib.machinery
import importlib.util
import pathlib
import sys

sys.dont_write_bytecode = True  # keep bin/ free of __pycache__

spec = importlib.util.spec_from_loader(
    "pr_status",
    importlib.machinery.SourceFileLoader(
        "pr_status", str(pathlib.Path(__file__).parent.parent / "bin" / "pr-status")))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

FAILED = []


def check(name, got, want):
    if got != want:
        FAILED.append(f"{name}: got {got!r}, want {want!r}")


def run(name, cases, call):
    """One table, one assertion per row: the case's own label names a failure."""
    for label, args, want in cases:
        check(f"{name}[{label}]", call(*args), want)


# --- the check rollup --------------------------------------------------------

def check_run(name, status="COMPLETED", conclusion="SUCCESS"):
    return {"__typename": "CheckRun", "name": name, "status": status,
            "conclusion": conclusion, "detailsUrl": f"https://ci.test/{name}"}


def status_context(context, state):
    return {"__typename": "StatusContext", "context": context, "state": state,
            "targetUrl": f"https://buildkite.test/{context}"}


def counted(rollup):
    got = m.classify_checks(rollup)
    return (got["state"], got["passed"], got["failed"], got["pending"], got["skipped"])


run("classify_checks", [
    ("nothing ran", ([],), ("none", 0, 0, 0, 0)),
    ("all green", ([check_run("a"), check_run("b")],), ("pass", 2, 0, 0, 0)),
    ("one failed", ([check_run("a"), check_run("b", conclusion="FAILURE")],), ("fail", 1, 1, 0, 0)),
    ("timed out counts as failed",
     ([check_run("a", conclusion="TIMED_OUT")],), ("fail", 0, 1, 0, 0)),
    ("still running", ([check_run("a", status="IN_PROGRESS", conclusion=None)],), ("pending", 0, 0, 1, 0)),
    ("queued is running", ([check_run("a", status="QUEUED", conclusion=None)],), ("pending", 0, 0, 1, 0)),
    # A workflow that skips half its jobs by design is not half failing, and it
    # is not half passing either — a skip is its own count.
    ("skipped is neither", ([check_run("a"), check_run("b", conclusion="SKIPPED")],), ("pass", 1, 0, 0, 1)),
    ("neutral is neither", ([check_run("a", conclusion="NEUTRAL")],), ("pass", 0, 0, 0, 1)),
    ("cancelled is neither", ([check_run("a", conclusion="CANCELLED")],), ("pass", 0, 0, 0, 1)),
    ("an external status posts state, not conclusion",
     ([status_context("buildkite/rails", "SUCCESS")],), ("pass", 1, 0, 0, 0)),
    ("an external error is a failure",
     ([status_context("buildkite/rails", "ERROR")],), ("fail", 0, 1, 0, 0)),
    ("an external pending is running",
     ([status_context("buildkite/rails", "PENDING")],), ("pending", 0, 0, 1, 0)),
    # Failing outranks running: a red build is news whether or not the rest of
    # the matrix has finished.
    ("failing outranks running",
     ([check_run("a", conclusion="FAILURE"), check_run("b", status="IN_PROGRESS", conclusion=None)],),
     ("fail", 0, 1, 1, 0)),
], counted)

failing = m.classify_checks([check_run("a", conclusion="FAILURE"), status_context("bk", "FAILURE")])
check("classify_checks names what failed",
      [c["name"] for c in failing["failing"]], ["a", "bk"])
check("classify_checks keeps each failure's own URL",
      [c["url"] for c in failing["failing"]],
      ["https://ci.test/a", "https://buildkite.test/bk"])


# --- reviews -----------------------------------------------------------------

def review(login, state):
    return {"author": {"login": login}, "state": state}


def reviewed(latest, requests):
    got = m.classify_reviews(latest, requests, "REVIEW_REQUIRED")
    return (got["approved"], got["changes"], got["commented"], got["requested"])


run("classify_reviews", [
    ("nobody yet", ([], []), ([], [], [], [])),
    ("one approval", ([review("a", "APPROVED")], []), (["a"], [], [], [])),
    ("changes requested", ([review("a", "CHANGES_REQUESTED")], []), ([], ["a"], [], [])),
    ("a comment is not a verdict", ([review("a", "COMMENTED")], []), ([], [], ["a"], [])),
    ("dismissed counts as nothing", ([review("a", "DISMISSED")], []), ([], [], [], [])),
    ("a team may be awaited as well as a person",
     ([], [{"__typename": "User", "login": "a"}, {"__typename": "Team", "name": "payroll"}]),
     ([], [], [], ["a", "payroll"])),
    # GitHub answers a null author for a deleted account, and the band would
    # otherwise print "@" with nothing after it.
    ("an author GitHub no longer has is left out",
     ([{"author": None, "state": "APPROVED"}], []), ([], [], [], [])),
], reviewed)

# `latestReviews` is one review per person, so someone who asked for changes and
# then approved arrives once, already as an approval.
check("classify_reviews takes each person's current position",
      m.classify_reviews([review("a", "APPROVED")], [], "APPROVED")["changes"], [])


# --- the description ---------------------------------------------------------

run("summarize_body", [
    ("plain prose", ("It rounds the stamp.",), "It rounds the stamp."),
    ("a heading is not the summary", ("## 概要\nIt rounds the stamp.",), "It rounds the stamp."),
    ("an HTML comment is template scaffolding",
     ("<!-- write here -->\nIt rounds the stamp.",), "It rounds the stamp."),
    ("an unticked checkbox is not prose",
     ("- [ ] tested\nIt rounds the stamp.",), "It rounds the stamp."),
    ("a rule is not prose", ("---\nIt rounds the stamp.",), "It rounds the stamp."),
    ("blank lines are skipped", ("\n\n  It rounds the stamp.  ",), "It rounds the stamp."),
    ("nothing but a template", ("## 概要\n<!-- here -->\n",), ""),
    ("no description at all", (None,), ""),
], m.summarize_body)

check("summarize_body cuts a long line to one row's worth",
      len(m.summarize_body("x" * 400)), m.BODY_CHARS)


# --- review threads ----------------------------------------------------------

def thread(resolved=False, path="app/x.rb", line=10, outdated=False, comment=True):
    node = {"isResolved": resolved, "isOutdated": outdated, "path": path,
            "line": line, "originalLine": 99, "comments": {"nodes": []}}
    if comment:
        node["comments"]["nodes"] = [
            {"author": {"login": "reviewer"}, "bodyText": "this branch",
             "url": "https://github.test/pull/1#discussion_r1"}]
    return node


picked = m.pick_threads([thread(), thread(resolved=True), thread(path="app/y.rb")])
check("pick_threads counts only what is unresolved", picked["unresolved"], 2)
check("pick_threads keeps where each one points",
      [i["path"] for i in picked["items"]], ["app/x.rb", "app/y.rb"])
check("pick_threads carries the remark's own URL",
      picked["items"][0]["url"], "https://github.test/pull/1#discussion_r1")

# An outdated thread has no current line, so the line it was written against
# stands in — otherwise the band points at line 0.
outdated = m.pick_threads([thread(line=None, outdated=True)])
check("pick_threads falls back to the original line", outdated["items"][0]["line"], 99)
check("pick_threads marks an outdated thread", outdated["items"][0]["outdated"], True)

empty = m.pick_threads([thread(comment=False)])
check("pick_threads survives a thread whose comment is gone", empty["items"][0]["author"], "")


# --- the whole object --------------------------------------------------------

run("parse_pr_url", [
    ("github.com", ("https://github.com/rails/rails/pull/58767",), ("rails", "rails", 58767)),
    ("an enterprise host", ("https://git.corp.test/team/app/pull/12",), ("team", "app", 12)),
    ("not a pull request", ("https://github.com/rails/rails/issues/1",), None),
    ("nothing at all", ("",), None),
], m.parse_pr_url)

VIEW = {
    "number": 58767,
    "title": "Make rate_limiting public",
    "url": "https://github.com/rails/rails/pull/58767",
    "state": "OPEN",
    "isDraft": False,
    "author": {"login": "timoschilling"},
    "baseRefName": "main",
    "headRefName": "public-rate-limiting",
    "additions": 123,
    "deletions": 20,
    "changedFiles": 3,
    "body": "## 概要\nrate_limit only applies via a before_action.",
    "mergeable": "MERGEABLE",
    "mergeStateStatus": "BLOCKED",
    "reviewDecision": "CHANGES_REQUESTED",
    "latestReviews": [review("adrianna", "CHANGES_REQUESTED")],
    "reviewRequests": [{"__typename": "User", "login": "byroot"}],
    "statusCheckRollup": [check_run("a"), check_run("b", conclusion="FAILURE")],
}

built = m.build_status(VIEW, [thread()], "public-rate-limiting")
check("build_status reports the state in lower case", built["state"], "open")
check("build_status says what the description says",
      built["body"], "rate_limit only applies via a before_action.")
check("build_status counts the checks", built["checks"]["failed"], 1)
check("build_status counts the threads", built["threads"]["unresolved"], 1)
check("build_status builds every screen off the pull request's own URL",
      built["links"],
      {"pr": "https://github.com/rails/rails/pull/58767",
       "checks": "https://github.com/rails/rails/pull/58767/checks",
       "files": "https://github.com/rails/rails/pull/58767/files",
       "commits": "https://github.com/rails/rails/pull/58767/commits"})

# A draft is open to GitHub, but it is not open for review, and the band draws a
# different mark for each.
check("build_status tells a draft from an open pull request",
      m.build_status({**VIEW, "isDraft": True}, [], "b")["state"], "draft")
check("build_status keeps merged as merged",
      m.build_status({**VIEW, "state": "MERGED", "isDraft": True}, [], "b")["state"], "merged")

# gh answers a bare `{}` for a pull request it could reach but knows nothing
# about; every field the band draws has to survive that.
bare = m.build_status({}, [], "branch")
check("build_status fills out an empty answer", (bare["number"], bare["title"], bare["links"]["pr"]),
      (0, "", ""))
check("build_status leaves no checks rather than none passing", bare["checks"]["state"], "none")


if FAILED:
    print("\n".join(FAILED))
    print(f"\n{len(FAILED)} failed")
    sys.exit(1)
print("bin/pr-status: all checks passed")
