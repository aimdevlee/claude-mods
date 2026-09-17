# player — an Apple Music controller

A band above the prompt that drives Apple Music. Official Apple interfaces only.

- Music.app's AppleScript dictionary: play, stop, skip, library search, playlists, volume, shuffle, repeat
- The iTunes Search API: Apple Music catalog search (no API key)

```
 ▛▜▄▞▐▙▗▟▞▄▐▛▙▗▄▟▞▐▄▛  ▶ Pop Off Pop Off          ████████░░░░░░░░░░░░ 0:16 / 2:21
 ▙▄▟▘▝▛▞▐▄▛▗▟▞▐▙▄▝▛▞▄  키키 — WhyKiiiKiii - EP
 ▐▞▛▄▙▗▝▘▟▞▐▄▛▙▗▄▟▘▝▛                            shuffle    █████████░ vol 95
 ▄▟▖▐▛▞▄▙▝▘▟▗▛▄▐▞▙▄▟▖  [ ⏮ ] [ ⏸ ] [ ⏭ ] [ vol− ] [ vol+ ] [ shuffle ] [ hide ]
```

## Installing

```bash
claude --plugin-dir /path/to/claude-mods/plugins/player
```

To keep it installed, register the repository as a marketplace — see the [repository README](../../README.md#installing).

While the plugin is on, this directory's `bin/` joins PATH, so the `player` command is there to use, and the `/player` command is registered.

## Using it

```
/player                     open / close the full band (closing falls back to compact)
/player 밤편지               rank library + catalog together and play the best hit
                            (opens it in Music.app when there is none)
/player 밤편지 - 아이유        add the artist to tell two songs of one title apart
/player pause | next | prev | toggle
/player volume 40
/player repeat all | shuffle on | seek 30
/player playlist Lo-Fi      play a playlist
/player playlists           list playlist names
/player search feather      the ranked library + catalog list (plays nothing)
/player catalog feather     catalog search results
/player compact | normal    the density (see below; compact is the default)
/player close               close the full band (back to compact)
```

Straight from the CLI: `player help`

## The status line

`~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "/path/to/claude-mods/plugins/player/bin/player-statusline"
  }
}
```

It prints, for example: `Fable  🎵 ▶ LOVE ATTACK · 리센느  ████░░░░ 1:22/3:01`

## The band above the prompt (a function hooks mod)

`hooks/register.tsx` is a Claude Code function-hooks plugin, the same shape as the official repository's `mods/`. One row (compact) appears above the prompt on its own while something is playing, and `/player` opens the full band in that same place. A one-second clock polls Music.app and redraws; the buttons are click-only.

The cover draws on the left, and the rows beside it fill its height with the artist, the album and the volume. A track with no artwork gets a plate of the same size, so neither the band's height nor the text's width moves when the song changes.

The band draws at one of two densities. `/player compact` and `/player normal` switch between them and the choice holds for the session. The cover's width, what each one shows and the meter lengths all sit together in `DENSITIES` in `hooks/register.tsx`.

Both draw in the same place, above the prompt; they differ in the **height** they take.

| Mode | Where | Cover | What it shows |
| --- | --- | --- | --- |
| `compact` (default) | one row above the prompt | none | title · artist, the position meter, transport / skip / size buttons |
| `normal` | a band above the prompt (4 rows) | 12×4 | the cover, the artist—album row, the shuffle / volume row |

`compact` is both the default and the resting state. **A session that starts with music playing shows it without a command being run.** It costs no room of its own, so there is nothing to turn off — and closing the band therefore falls back to compact rather than to nothing.

`/player` opens the full band and `/player` again closes it back to the compact row. `/player compact` and `/player normal` name the same two states explicitly.

Both draw in the `AbovePrompt` slot. The footers below the prompt (`SessionMode`'s `auto mode on`, `PromptHint`'s `? for shortcuts`) are left alone. When Music.app goes idle the hook passes and compact gives the row back.

So that nothing is shown twice, the session status line stays empty whenever the track is already on screen (compact or the open band). `bin/player-statusline` — the terminal's own status line — is separate and still works.

The band's rows gather beside the cover instead of stretching to the right edge. Pushed apart across 150 columns, the title and the clock stop reading as a pair and the band looks like scattered pieces.

The meter draws its filled and empty halves in different colors. Dimmed as one string, the two glyphs carry about the same weight and it reads as a grey smear.

`normal`:

```
 ▛▜▄▞▐▙▗▟▞▄▐▛  ▶ Pop Off Pop Off  ████████░░░░░░░░ 0:16 / 2:21
 ▙▄▟▘▝▛▞▐▄▛▗▟  키키 — WhyKiiiKiii - EP
 ▐▞▛▄▙▗▝▘▟▞▐▄  shuffle  ███████░ vol 95
 ▄▟▖▐▛▞▄▙▝▘▟▗  [◀◀] [◀] [‖] [▶] [▶▶] [−] [+] [⇄] [↻] [▼]
```

`compact` — one row in the same place. The artist moves up to the title row, and the volume, shuffle and repeat buttons drop out (commands drive them):

```
 ▶ Pop Off Pop Off · 키키  █████░░░ 0:16 / 2:21  [◀◀] [◀] [‖] [▶] [▶▶] [▲]
 › type here                                     (the prompt)
```

The last button is the size toggle. Compact opens the full band with `▲` and normal folds back to one row with `▼` — the same thing typing `/player` does, so the band can be resized from inside the band.

There is no close button. Compact is where closing ends, so there is nowhere further to hide it, and it gives the row back on its own when playback stops.

`◀` and `▶` skip ten seconds each. Clicking the position bar to jump to that point is not something we can build — `ui.press` carries only `{ plugin, element, component, surface }`, and which cell of the bar the pointer landed on never arrives. Splitting the bar into one Button per cell makes the pressed `key` stand in for the position, but Buttons come with `[ ]` chrome, so it becomes `[█][░][░]` and no longer reads as a bar.

`seek` takes an absolute position, so a skip is computed from the current one and clamped at both ends. Seeking past the end rolls into the next track, and that is `▶▶`'s job.

A mode that draws no cover exports no artwork at all, so `compact` adds no image work to the one-second poll.

The button glyphs are **only the ones the coding font actually has**. Of the `⏮ ⏪ ⏸ ⏩ ⏭ ⤨ 🔁 ✕` set we started with, 8 of 10 are missing from PlemolJP Console NF, so each fell back on its own — some to a text font, some to the color emoji font, mixing blue badges in among monochrome glyphs and widening to two cells.

They are one family of triangles now. A skip is one triangle (`◀` `▶`) and a track move is two (`◀◀` `▶▶`), so they read as degrees of the same action. Repeat has three states (`off → all → one`), which color alone cannot tell apart, so `one` draws as `↻1`.

Before changing a glyph, check the font's `cmap` for that codepoint. Without it the terminal pulls the character from some other font, and which one is out of our control.

Being one family, the buttons read as a single strip of controls. Shuffle and repeat mark themselves on by color rather than by a longer label, so a state change never pushes the row around.

The cover comes from Music.app over AppleScript as the original PNG, is reduced by `sips` to a 24×8 pixel BMP, and is packed two-by-two pixels per cell with the quadrant blocks (`▘▝▀▖▌▞▛▗▚▐▜▄▙▟█`). A cell can hold two colors, so the four pixels are split by brightness and the brighter mean becomes the foreground, the darker one the background. That is twice the pixels per screen area of the half blocks (`▀`), which fit only two pixels to a cell. It is re-extracted only when the track changes and the result is cached, so the one-second poll does not rebuild the image every time.

The image is square, yet on screen it comes out squeezed or stretched, because a terminal cell is itself taller than it is wide. `CELL_ASPECT` (2.7) in `bin/player-art` pulls a correspondingly wider pixel image to cancel that out.

The value differs per terminal and moves with the font or with settings like Ghostty's `adjust-cell-height`. If the cover looks distorted, screenshot it, measure width ÷ height, multiply the current value by that ratio, and this one number is the only fix. Changing the ratio also changes how many rows a given width produces (`player art 12` → 4 rows), so `DENSITIES`'s `rows` has to be brought back in line.

The feature is early access, so an environment variable turns it on (as of 2.1.272):

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir /path/to/claude-mods/plugins/player
```

The buttons answer to mouse clicks only — digit hotkeys collided with typing digits into the composer, so they are gone.

Development (from the repository root):

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin validate ./plugins/player
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test ./plugins/player
bunx --bun tsc -p tsconfig.json
```

The type declarations (`.claude/types/claude-code.d.ts`) and `tsconfig.json` live at the repository root, shared by every mod.

## Known limits

- The band's (function hooks) API is early access and can change between Claude Code releases.
- macOS only. The first run raises the "Terminal wants to control Music" permission prompt.
- **Search turns over every playlist.** Beyond the library it finds songs in subscription playlists ("Top 100: Today" and the like) and plays them straight away — those are `shared track`s, which AppleScript can play.
- **A song that is nowhere is not played for you.** It is opened in Music.app and you press play (see below). No Accessibility permission is needed.
- The iTunes Search API behind `player catalog` / `player open` returns storefront-specific IDs, and the Korean storefront (`country=KR`) returns no song results at all. Use it for listings only. `PLAYER_COUNTRY` changes the country (`US` by default).
- Album art draws only for tracks Music.app holds artwork for.

## Why a song outside the library is not played for you

Music.app's AppleScript dictionary reaches **only as far as the library**. `search` returns playlists, `add` takes local files, and `play` takes library items. No command points at a catalog search result.

`open location` can open the song's page, but the track IDs the iTunes Search API hands out **differ per storefront**. A US store ID opened under a Korean account has nothing to play, and the Korean storefront (`country=KR`) returns no song or album results at all, so there is no ID to substitute (artist search does work).

Driving the window directly through System Events does work. An earlier version did exactly that — `⌘F` to focus the search field, type the title, then `AXPress` the first result card. But that way **moves the real cursor and demands Accessibility permission**, and it breaks silently whenever Music.app's view structure changes. Too high a price for playing one song, so it was taken out.

So today: in the library, it plays; not in the library, it is opened in Music.app and we stop there.
