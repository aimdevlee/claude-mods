# claude-mods

A collection of Claude Code extensions (mods). One mod is one directory under `plugins/`, and the repository root holds nothing but the list of them (a marketplace).

## The mods

| mod | What it is |
| --- | --- |
| [player](plugins/player/) | A band above the prompt that drives Apple Music (macOS) |
| [pr-status](plugins/pr-status/) | A band above the prompt for your branch's pull request, with a link to every GitHub screen |

## Layout

```
.claude-plugin/marketplace.json   the mods this repository offers
plugins/<mod>/
  .claude-plugin/plugin.json      that mod's name, version and description
  hooks/                          function hooks (hooks.json + register.tsx)
  bin/                            executables that join PATH while the mod is on
  tests/                          that mod's tests
  README.md                       that mod's documentation
.claude/types/claude-code.d.ts    the plugin API declarations (shared by every mod)
tsconfig.json                     checks plugins/*/hooks and plugins/*/tests in one pass
```

Mods share no code. `bin/` joins PATH relative to the mod's own root and the hooks find their files through `$.plugin.root`, so a mod directory can be moved wholesale — or split out into its own repository — with no path to fix inside it.

Metadata like the version and the description lives in `plugin.json` alone. A `marketplace.json` entry carries only the name and the `source` path, so releasing a version never means keeping two files in step.

## Installing

Register the repository as a marketplace and pick the mods to turn on.

```
/plugin marketplace add /path/to/claude-mods
/plugin install player@claude-mods
```

For one session only, hand the directory over directly. Given `plugins/`, every mod under it loads; given one mod, only that one does.

```bash
claude --plugin-dir /path/to/claude-mods/plugins          # all of them
claude --plugin-dir /path/to/claude-mods/plugins/player   # just one
```

A mod that uses function hooks needs the environment variable, the feature being early access (as of 2.1.272):

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir /path/to/claude-mods/plugins
```

## Adding a mod

1. Write the name, description and version into `plugins/<name>/.claude-plugin/plugin.json`.
2. Add only what it needs — `hooks/`, `bin/`, `commands/`, `skills/`, `agents/`, `tests/`, `README.md`.
3. Add `{ "name": "<name>", "source": "./plugins/<name>" }` to the `plugins` array in `.claude-plugin/marketplace.json`.
4. Run the checks below.

## Checks and tests

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin validate .                 # the mod list
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin validate ./plugins/player  # one mod
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test ./plugins/player      # *.test.tsx
bunx --bun tsc -p tsconfig.json                                             # the whole repo
```

`validate` and `test` each take one mod. To run them over all of them, wrap the call:

```bash
for m in plugins/*/; do CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test "$m"; done
```

`.claude/types/claude-code.d.ts` holds the plugin API declarations. After a Claude Code update, regenerate it from a session with `/plugin-types`.
