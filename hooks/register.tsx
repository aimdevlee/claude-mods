/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import type { EngineInterface, Register } from 'claude-code'

/**
 * The cassette band directly above the prompt. `/player` toggles it,
 * `/player <query>` plays a song, and every CLI verb (pause, next, search,
 * playlist, ...) is forwarded, so the band is the only entry point. A one-second clock polls Music.app through
 * `bin/player status` and redraws. The transport Buttons are click-only — no
 * hotkeys, so typing digits into the composer stays typing digits.
 *
 * The band draws at one of three densities, chosen with `/player compact`,
 * `/player normal` or `/player full` and remembered for the session:
 *
 *   compact  3 rows, a 12x2 cover — the track, a meter, one row of buttons
 *   normal   5 rows, a 20x4 cover — adds the byline and the volume (default)
 *   full     7 rows, a 28x6 cover — adds a framed header and the mode row
 *
 * In every mode a Raster of the cover sits on the left (a 2x2 pixel block per
 * terminal cell, via the quadrant blocks) and the text rows fill its height
 * beside it. A track with no artwork gets a plate of the same size, so the band
 * never changes height between songs.
 * Music.app stays the player: this band is its remote.
 */

const COMMAND = 'player'
const POLL_MS = 1000

// Subcommands `/player` forwards to the CLI verbatim.
//
// TRANSPORT changes what is playing, so the band redrawing is the answer and
// nothing is printed. LISTING answers a question, so its output is the reply
// and the band is left alone. Anything not named here is a song to play, which
// keeps the common `/player <song>` free of a verb.
const TRANSPORT = new Set([
  'pause', 'stop', 'toggle', 'next', 'prev', 'previous',
  'seek', 'volume', 'shuffle', 'repeat', 'playlist',
])
const LISTING = new Set(['search', 'search-library', 'catalog', 'playlists', 'open'])

/**
 * The three densities. `art` is the cover's width in columns; `bin/player art`
 * derives the height from it (it keeps the cover square on screen), and `rows`
 * records what it answers, so the plate drawn for a coverless track matches.
 *
 * `rows` is therefore not free: it is `bin/player-art`'s own arithmetic, and a
 * value that disagrees makes a coverless track a different height from a
 * covered one. Measured, not guessed — 12→2, 20→4, 36→7. Changing `art` means
 * re-running `player art <n>` and copying the row count it answers.
 * `meter` is the position bar's width, and `volumeMeter` the volume's; 0 means
 * the mode leaves that bar out and prints only the numbers.
 */
export type Density = 'compact' | 'normal' | 'full'

export const DENSITIES: Record<Density, {
  art: number
  rows: number
  byline: boolean
  meta: boolean
  modes: boolean
  frame: boolean
  meter: number
  volumeMeter: number
}> = {
  compact: { art: 12, rows: 2, byline: false, meta: false, modes: false, frame: false, meter: 12, volumeMeter: 0 },
  normal: { art: 20, rows: 4, byline: true, meta: false, modes: true, frame: false, meter: 16, volumeMeter: 8 },
  full: { art: 36, rows: 7, byline: true, meta: true, modes: true, frame: true, meter: 24, volumeMeter: 10 },
}

const DEFAULT_DENSITY: Density = 'normal'
const isDensity = (word: string): word is Density => word in DENSITIES

type Track = {
  state: 'playing' | 'paused' | 'stopped'
  title?: string
  artist?: string
  album?: string
  duration?: number
  position?: number
  volume?: number
  shuffle?: boolean
  repeat?: string
  // Extras the CLI emits only when the track actually carries them: a
  // streaming track usually has a genre and nothing else, a ripped one has all
  // three. The full-size band shows what arrived and omits the rest.
  genre?: string
  year?: number
  plays?: number
}

type Host = {
  run: (...args: string[]) => Promise<string>
  invalidate: () => void
  status: (text: string | undefined) => void
  every: EngineInterface['clock']['every']
}

/** The cover, already packed as Raster cells by `bin/player art`. */
type Art = { columns: number; rows: number; cells: string }

/**
 * The plate drawn where a cover would go when the track has none: same size,
 * so the band keeps its height and the rows beside it keep their width whether
 * or not the artwork arrived. A dim frame around a centred note.
 */
export function placeholderArt(columns: number, rows: number): Art {
  const frame = 0x00242a38
  const face = 0x00171b26
  const mark = 0x004a5568
  // Only blocks and shades: a Raster cell must be a width-1 BMP character, and
  // a music note (U+266A) is ambiguous-width, so it can be drawn two cells wide
  // and shift the plate. These are the glyphs the cover already proves render.
  const shade = 0x2591 // ░
  const full = 0x2588 // █
  const midRow = Math.floor((rows - 1) / 2)
  const midColumn = Math.floor((columns - 1) / 2)
  const words: number[] = []
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < columns; c += 1) {
      const isEdge = r === 0 || r === rows - 1 || c === 0 || c === columns - 1
      // A small bar in the middle, standing in for a record with no sleeve.
      const isMark = r === midRow && c >= midColumn - 1 && c <= midColumn + 2
      if (isMark) words.push(full, mark, face)
      else if (isEdge) words.push(shade, frame, face)
      else words.push(0x0020, face, face)
    }
  }
  const bytes = new Uint8Array(Uint32Array.from(words).buffer)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return { columns, rows, cells: btoa(binary) }
}

const STOPPED: Track = { state: 'stopped' }

/** `bin/player art` answers `columns: 0` for an idle player or a coverless track. */
export function parseArt(text: string): Art | undefined {
  try {
    const parsed: unknown = JSON.parse(text.trim())
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const { columns, rows, cells } = parsed as Partial<Art>
    if (typeof columns !== 'number' || typeof rows !== 'number') return undefined
    if (typeof cells !== 'string' || columns <= 0 || rows <= 0) return undefined
    return { columns, rows, cells }
  } catch {
    return undefined
  }
}

function parseTrack(text: string): Track {
  try {
    const parsed: unknown = JSON.parse(text.trim())
    if (typeof parsed === 'object' && parsed !== null && 'state' in parsed) {
      return parsed as Track
    }
  } catch {
    // not JSON: Music.app is not answering
  }
  return STOPPED
}

const mmss = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// East-Asian wide characters take two cells.
const cellWidth = (ch: string) => {
  const code = ch.codePointAt(0) ?? 0
  const wide =
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff)
  return wide ? 2 : 1
}

const widthOf = (text: string) => [...text].reduce((n, ch) => n + cellWidth(ch), 0)

function clip(text: string, width: number): string {
  let out = ''
  let used = 0
  for (const ch of text) {
    const w = cellWidth(ch)
    if (used + w > width) return out.length < text.length ? out.slice(0, -1) + '…' : out
    out += ch
    used += w
  }
  return out
}

export const iconOf = (track: Track) =>
  track.state === 'playing' ? '▶' : track.state === 'paused' ? '‖' : '■'

/**
 * A meter drawn with the block glyphs the cover already proves this terminal
 * has. U+25AE/25AF (`▮▯`) looked right but fell back to tofu in the session's
 * font, so the fill is a full block and the track a light shade.
 */
export function meterOf(fraction: number, width: number): string {
  if (width <= 0) return ''
  // A zero duration divides to NaN, which would otherwise widen to nothing and
  // shift everything on the row; an empty meter keeps the columns still.
  const ratio = Number.isFinite(fraction) ? fraction : 0
  const filled = Math.max(0, Math.min(width, Math.round(width * ratio)))
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

/**
 * The band's first row: what plays, and where it is, fitted to `columns`.
 *
 * The position bar is the mode's width, shrunk to what the row can spare and
 * dropped entirely when fewer than six columns are left for it — a narrow
 * terminal keeps the title and the clock, which are the row's point.
 */
export function trackLineOf(
  track: Track,
  columns: number,
  density: Density = DEFAULT_DENSITY,
): { left: string; right: string } {
  if (track.title === undefined) {
    return { left: '■ Apple Music: nothing playing', right: '' }
  }
  const position = track.position ?? 0
  const duration = track.duration ?? 0
  const clock = `${mmss(position)} / ${mmss(duration)}`
  // Compact has no byline row, so the artist rides here or goes unsaid.
  const name = DENSITIES[density].byline
    ? track.title
    : [track.title, track.artist].filter(Boolean).join(' · ')
  const title = `${iconOf(track)} ${name}`
  const spare = columns - widthOf(clock) - widthOf(title) - 3
  const barWidth = Math.min(DENSITIES[density].meter, Math.max(0, spare))
  const bar = barWidth >= 6 ? `${meterOf(duration > 0 ? position / duration : 0, barWidth)} ` : ''
  const right = `${bar}${clock}`
  const left = clip(title, Math.max(10, columns - widthOf(right) - 2))
  return { left, right }
}

/** `artist — album`, the pair that names a track apart from its title. */
export function bylineOf(track: Track): string {
  return [track.artist, track.album].filter(Boolean).join(' — ')
}

/**
 * The extras row full mode adds: genre, year and play count, whichever of them
 * Music.app reported. A streaming track usually answers with the genre alone,
 * so this is often one word — and empty when it is not even that, in which
 * case the caller drops the row rather than drawing a blank one.
 */
export function metaLineOf(track: Track): string {
  const plays = track.plays ?? 0
  return [
    track.genre,
    track.year !== undefined && track.year > 0 ? String(track.year) : '',
    plays > 0 ? `♥ ${plays}회 재생` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * The rows that fill the cover's height beside it. Which ones appear is the
 * mode's call: compact has room for neither, so the artist rides the track row
 * instead, while normal and full give the byline and the modes-and-volume row
 * a line each.
 */
export function detailRowsOf(
  track: Track,
  columns: number,
  density: Density = DEFAULT_DENSITY,
): { left: string; right: string }[] {
  if (track.title === undefined) return []
  const mode = DENSITIES[density]
  const rows: { left: string; right: string }[] = []
  if (mode.byline) {
    const byline = bylineOf(track)
    if (byline !== '') rows.push({ left: clip(byline, Math.max(10, columns - 2)), right: '' })
  }
  if (mode.meta) {
    const meta = metaLineOf(track)
    if (meta !== '') rows.push({ left: clip(meta, Math.max(10, columns - 2)), right: '' })
  }
  if (mode.modes) {
    const volume = track.volume ?? 0
    const width = mode.volumeMeter
    // The volume bar is worth its room only once the row has some; below that
    // the number alone says it, and the modes keep the left of the row.
    const meter = width > 0 && columns >= 60 ? `${meterOf(volume / 100, width)} ` : ''
    const modes = [
      track.shuffle ? 'shuffle' : '',
      track.repeat && track.repeat !== 'off' ? `repeat ${track.repeat}` : '',
    ]
      .filter(Boolean)
      .join('  ')
    rows.push({ left: modes, right: `${meter}vol ${volume}` })
  }
  return rows
}

/**
 * One line for the status row under the prompt while the band is hidden — the
 * only place the track shows then, so it carries a short meter as well as the
 * clock. An artist the CLI did not report leaves out its separator instead of
 * printing a dangling one.
 */
export function statusLineOf(track: Track): string | undefined {
  if (track.title === undefined) return undefined
  const position = track.position ?? 0
  const duration = track.duration ?? 0
  const name = [track.title, track.artist].filter(Boolean).join(' · ')
  const meter = meterOf(duration > 0 ? position / duration : 0, 8)
  return `🎵 ${iconOf(track)} ${name}  ${meter} ${mmss(position)}/${mmss(duration)}`
}

export const register: Register = on => {
  let host: Host | undefined
  let track: Track = STOPPED
  let art: Art | undefined
  let artOf: string | undefined
  let isShown = false
  let note: string | undefined
  let isPolling = false
  let density: Density = DEFAULT_DENSITY

  /**
   * What identifies a cover: re-export only when the track itself changes —
   * or when the mode does, since each density asks for its own width.
   */
  const artKeyOf = (t: Track) =>
    t.title === undefined ? undefined : `${t.title}|${t.album ?? ''}|${density}`

  async function poll(engine: Host) {
    if (isPolling) return
    isPolling = true
    try {
      const next = parseTrack(await engine.run('status'))
      const changed = JSON.stringify(next) !== JSON.stringify(track)
      track = next
      engine.status(isShown ? undefined : statusLineOf(track))

      // The CLI caches per track, but the round trip still costs; only ask when
      // the track changed, and only while the band is on screen to show it.
      const key = artKeyOf(track)
      let artChanged = false
      if (key === undefined) {
        artChanged = art !== undefined
        art = undefined
        artOf = undefined
      } else if (isShown && key !== artOf) {
        artOf = key
        art = parseArt(await engine.run('art', String(DENSITIES[density].art)))
        artChanged = true
      }

      if ((changed || artChanged) && isShown) engine.invalidate()
    } finally {
      isPolling = false
    }
  }

  async function act(engine: Host, ...args: string[]) {
    const out = (await engine.run(...args)).trim()
    if (args[0] === 'play' && out.includes('opened in Music.app')) {
      note = 'not in your library — opened in Music.app: press play, or + to add it'
    } else if (args[0] === 'play' && out.includes('is ambiguous')) {
      note = `"${args[1] ?? ''}" is ambiguous — run /player search to choose`
    } else if (args[0] === 'play' && out.includes('no match')) {
      note = `no match for "${args[1] ?? ''}"`
    } else {
      note = undefined
    }
    await poll(engine)
    engine.invalidate()
  }

  on('session.start', async ($, e, next) => {
    const cli = `${$.plugin.root}/bin/player`
    host = {
      run: async (...args) => {
        // A catalog play drives Music.app's own search and waits for results.
        const timeoutMs = args[0] === 'play' ? 45000 : 15000
        const { stdout } = await $.process.run([cli, ...args], { timeoutMs })
        return stdout
      },
      invalidate: () => $.ui.invalidate('ui.render'),
      status: text => $.ui.status(text),
      every: (ms, fn) => $.clock.every(ms, fn),
    }
    await $.command.register({
      name: COMMAND,
      description:
        'Apple Music above the prompt: /player toggles the band, /player <song> plays it, compact | normal | full set how much the band draws, and pause | next | prev | volume | shuffle | repeat | seek | playlist | playlists | search | catalog work as they do in the CLI',
      argumentHint: '[song | pause | next | compact | full | search <song> | playlist <name> | close]',
    })
    const engine = host
    engine.every(POLL_MS, () => {
      void poll(engine).catch(() => undefined)
    })
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e, next) => {
    if (!host) return next(e)
    const engine = host
    const query = e.args.trim()
    if (query === 'close' || query === 'off') {
      isShown = false
      engine.invalidate()
      engine.status(statusLineOf(track))
      // Silent: the band appearing or leaving is the answer, and a line per
      // toggle buries the transcript (the status row carries it while hidden).
      return {}
    }
    // A density word sets how the band draws and shows it, which is the whole
    // answer — so nothing is printed, as with the toggle. The cover is the one
    // thing that cannot just be re-laid out: the new mode wants its own width,
    // so the poll re-exports it (`artKeyOf` carries the mode for that reason).
    if (isDensity(query)) {
      density = query
      isShown = true
      engine.status(undefined)
      engine.invalidate()
      void poll(engine).catch(() => undefined)
      return {}
    }
    // Bare `open`/`on` shows the band; `open <song>` is the CLI's own verb.
    if (query !== '' && query !== 'on' && query !== 'open') {
      const [verb = '', ...rest] = query.split(/\s+/)
      const args = rest.join(' ')

      // A question: the CLI's own output is the answer, so print it and leave
      // the band as it is.
      if (LISTING.has(verb)) {
        const out = (await engine.run(verb, ...(args ? [args] : []))).trim()
        return { text: out || `nothing for "${query}"` }
      }

      isShown = true
      engine.status(undefined)

      if (TRANSPORT.has(verb)) {
        await act(engine, verb, ...(args ? [args] : []))
        return note ? { text: note } : {}
      }

      await act(engine, 'play', query)
      return { text: note ?? `playing: ${track.title ?? query}` }
    }
    isShown = !isShown
    engine.status(isShown ? undefined : statusLineOf(track))
    engine.invalidate()
    if (isShown) void poll(engine).catch(() => undefined)
    return {}
  })

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    const engine = host
    if (!engine || !isShown || e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    const { Box, Text, Button, Raster } = $.ui.resolve(e)
    const mode = DENSITIES[density]
    // Leave the right edge to the engine's collapse mark (`[-]`).
    const outer = Math.max(20, e.props.bodyColumns - 6)
    // A coverless track gets a plate the same size, so the band does not
    // change height or reflow as the artwork comes and goes between songs.
    const cover = art ?? placeholderArt(mode.art, mode.rows)
    // The art takes its columns plus a gap; the text rows get what is left.
    // A frame spends two more columns on its border and padding.
    const columns = Math.max(20, outer - cover.columns - 2 - (mode.frame ? 4 : 0))
    const { left, right } = trackLineOf(track, columns, density)
    const volume = track.volume ?? 50
    const press = (...args: string[]) => () => {
      void act(engine, ...args).catch(() => undefined)
    }
    // Click-only: no hotkeys, so digits typed into the composer stay digits.
    // Every transport label is a glyph of the same family, so the row reads as
    // one control strip rather than icons and words side by side; a mode that
    // is on is marked by colour, not by the label growing and shifting the row.
    const key = (name: string, label: string, opts: { on?: boolean } = {}) =>
      (...args: string[]) => (
        <Button key={name} color={opts.on === true ? 'success' : undefined} onPress={press(...args)}>
          {label}
        </Button>
      )

    // The band is as tall as the art, so the extra rows carry the byline and
    // the volume instead of sitting empty.
    const details = detailRowsOf(track, columns, density)
    const repeats = { off: 'all', all: 'one', one: 'off' } as const
    const repeat = track.repeat === 'all' || track.repeat === 'one' ? track.repeat : 'off'

    const buttons = (
      <Box gap={1}>
        {key('prev', '⏮')('prev')}
        {key('play', track.state === 'playing' ? '⏸' : '▶')('toggle')}
        {key('next', '⏭')('next')}
        {key('vol-', '−')('volume', String(Math.max(0, volume - 5)))}
        {key('vol+', '＋')('volume', String(Math.min(100, volume + 5)))}
        {key('shuffle', '⤨', { on: track.shuffle === true })(
          'shuffle',
          track.shuffle === true ? 'off' : 'on',
        )}
        {mode.modes
          ? key('repeat', repeat === 'one' ? '🔂' : '🔁', { on: repeat !== 'off' })(
              'repeat',
              repeats[repeat],
            )
          : null}
        <Button
          key="close"
          dimColor
          onPress={() => {
            isShown = false
            engine.invalidate()
            engine.status(statusLineOf(track))
          }}
        >
          ✕
        </Button>
      </Box>
    )

    const body = (
      <Box flexDirection="column" width={columns}>
        <Box justifyContent="space-between">
          <Text bold={track.state === 'playing'}>{left}</Text>
          <Text dimColor>{right}</Text>
        </Box>
        {details.map((row, i) => (
          <Box key={`detail-${i}`} justifyContent="space-between">
            <Text dimColor>{row.left}</Text>
            <Text dimColor>{row.right}</Text>
          </Box>
        ))}
        {buttons}
        {note !== undefined ? <Text color="warning">{note}</Text> : null}
      </Box>
    )

    const band = (
      <Box width={mode.frame ? undefined : outer} paddingX={1} gap={1}>
        <Raster key="cover" columns={cover.columns} rows={cover.rows} cells={cover.cells} />
        {body}
      </Box>
    )

    // Full mode spends its extra rows on a border and a title, which is what
    // makes it read as a device rather than as a line of text with a picture.
    if (!mode.frame) return band

    return (
      <Box width={outer} flexDirection="column" borderStyle="round" borderDimColor>
        <Box paddingX={1}>
          <Text dimColor>APPLE MUSIC</Text>
        </Box>
        {band}
      </Box>
    )
  })
}
