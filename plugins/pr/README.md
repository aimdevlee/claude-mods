# pr — the pull request, above the prompt

The pull request for the branch you are on, drawn where you are already looking. GitHub's own interfaces only: `gh pr view --json` and one GraphQL query.

```
 ◔ #58788  Make ActionController::RateLimiting#rate_limiting public   +123 −20  3 files
   @timoschilling  ·  public-rate-limiting → main
   rate_limit only applies via a before_action, evaluated before the action runs.
   checks   ✓ 7 × 2 ⋯ 1  rails-new-docker  buildkite/rails
   review   changes @adrianna  ·  approved @nvasilevski  ·  waiting @byroot
   threads  schema_context.rb:149  @adrianna Opting to read the definition off…  +2
   open     pr  checks  files  commits                                   [↻] [▼]
```

Every underlined word is a hyperlink: the pull request, its checks, its files, its commits, each failing check, and the remark itself.

## Installing

```bash
claude --plugin-dir /path/to/claude-mods/plugins/pr
```

To keep it installed, register the repository as a marketplace — see the [repository README](../../README.md#installing).

It needs `gh` on PATH and logged in (`gh auth status`). While the plugin is on, this directory's `bin/` joins PATH, so the `pr` command is there to use, and the `/pr` command is registered.

## Using it

```
/pr                    open / close the full band (closing falls back to compact)
/pr 58788              pin the band to another pull request
/pr branch             back to the branch's own
/pr refresh            fetch again now, past the cache
/pr compact | normal   the density (see below; compact is the default)
/pr close              close the full band (back to compact)

/pr show               the pull request at a glance, printed into the transcript
/pr body               the whole description
/pr checks             every failing and running check, with its URL
/pr reviews            who approved, who asked for changes, who is still awaited
/pr comments           every unresolved review thread: file:line, author, URL
/pr files              changed files with +/−
/pr diff               the unified diff
/pr web                open it in the browser
```

Straight from the CLI: `pr help`

## The band above the prompt (a function hooks mod)

`hooks/register.tsx` is a Claude Code function-hooks plugin, the same shape as the official repository's `mods/`. One row (compact) appears above the prompt on its own whenever the branch has a pull request, and `/pr` opens the full band in that same place.

| Mode | Where | What it shows |
| --- | --- | --- |
| `compact` (default) | one row above the prompt | the badge, the number, the title, `✓ × ⋯` counts, where the review stands, how much is unresolved |
| `normal` | a band above the prompt (up to 7 rows) | adds the byline, the description's first line, the failing checks by name, who reviewed, the newest unresolved remark, and a link per screen |

`compact` is both the default and the resting state. **A session started on a branch that has a pull request shows it without a command being run**, and a branch with none draws nothing at all — so there is nothing to turn off, and closing the band falls back to compact rather than to nothing.

`/pr` opens the full band and `/pr` again closes it back to the compact row. `/pr compact` and `/pr normal` name the same two states explicitly. The last button is the size toggle, so the band can be resized from inside the band — `▲` opens it, `▼` folds it back.

Both draw in the `AbovePrompt` slot. The footers below the prompt (`SessionMode`'s `auto mode on`, `PromptHint`'s `? for shortcuts`) are left alone.

`compact` — one row in the same place:

```
 ◔ #58788 Make ActionController::RateLimiting#rate_lim…  ✓ 7 × 2 ⋯ 1  3 unresolved  [↻] [▲]
 › type here                                                              (the prompt)
```

### Why the links

A band is a glance, not a screen. It can say that two checks failed and that three remarks are open; it cannot show you the log or the diff, and squeezing either in would cost the glance. So each thing it names is an OSC 8 hyperlink to the GitHub screen that holds the rest: the number to the pull request, `checks` `files` `commits` to those tabs, a failing check to its own run, and a remark to that very comment anchor.

An href the engine will not carry takes down the whole tree it is in, and these do not all come from GitHub — an external status check posts whatever URL it likes. So a URL is checked against what `LinkProps` documents (`https:`, printable ASCII, under 2048 characters) before it becomes a Link, and anything else is drawn as the same word in plain text. A Jenkins box on `http://ci.internal` costs you the link, not the band.

### What the glyphs are

`◔` open · `◌` draft · `●` merged · `⊘` closed — one family of circles, filling as the pull request moves.

`✓` passed · `×` failed · `⋯` running. A skipped, neutral or cancelled check is counted as none of the three: a workflow that skips half its jobs by design is not half failing, and it is not half passing either.

The glyphs are **only the ones the coding font actually has**. `✗`, `⧗` and `💬` were the obvious first picks and all three are missing from PlemolJP Console NF, so each would have fallen back on its own — some to a text font, some to the color emoji font, mixing blue badges in among monochrome glyphs and widening to two cells. Before changing a glyph, check the font's `cmap` for that codepoint.

### How the rows narrow

A Box that overflows the band does not wrap; it pushes the prompt sideways. So every row spends its width before it draws, gaps included, and drops parts rather than squeezing them.

Compact keeps the badge, the number and the title, then adds as many of the three summaries as still leave the title twelve cells. They are kept in the order they cost you something — a failing check and an unresolved remark ask for work, the review word is most often only "waiting" — so the least useful part goes first. Below the width of the badge and the number the row is given back to whatever draws beneath.

In the band, the counts row goes rather than clipping (`✓ 7 ×…` would read as a different tally), the remark row keeps its file name whole or not at all (a clipped name is not one you can recognise), and the link row drops links from the right.

### How often it asks GitHub

`bin/pr` caches `status` on disk and the hook polls that every five seconds. The cache key carries the branch **and the commit HEAD points at**, so a push answers fresh straight away — the one moment a stale band is most obviously wrong — while a 30-second TTL covers CI moving under a commit that has not changed. `PR_BAND_TTL` changes it; `[↻]` and `/pr refresh` go past it.

Each fetch is two round trips: `gh pr view --json` for the pull request and its check rollup, then one GraphQL query for the review threads. Whether a thread is resolved lives only in the GraphQL schema — `gh pr view` cannot answer it — and it is the fact the band most wants, so the second request is the price of the `threads` row.

The feature is early access, so an environment variable turns it on (as of 2.1.272):

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir /path/to/claude-mods/plugins/pr
```

The buttons answer to mouse clicks only.

Development (from the repository root):

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin validate ./plugins/pr
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test ./plugins/pr
python3 plugins/pr/tests/test_pr.py
bunx --bun tsc -p tsconfig.json
```

The type declarations (`.claude/types/claude-code.d.ts`) and `tsconfig.json` live at the repository root, shared by every mod.

## Known limits

- The band's (function hooks) API is early access and can change between Claude Code releases.
- **It reads; it does not write.** No approving, no merging, no commenting. `/pr web` hands you to the browser for those.
- A pull request opened from a fork whose branch is not on the upstream repository is resolved by `gh` the same way `gh pr view` resolves it — if `gh pr view` cannot find it from your checkout, neither can the band.
- The first 100 review threads are read. Past that, `unresolved` undercounts.
- A repository whose checks post to an `http://` host shows those check names without links (see above).
- `gh` must be authenticated for the host. The band draws nothing rather than an error when it is not; `/pr show` prints what `gh` said.
