import type { On, RenderElement, RenderInput } from 'claude-code'
import { describe, expect, mock, test, tier } from 'claude-code/testing'

tier('user')

const PLAYING = JSON.stringify({
  state: 'playing',
  title: 'LOVE ATTACK',
  artist: '리센느',
  album: 'SCENEDROME - EP',
  duration: 181.6,
  position: 82.7,
  volume: 100,
  shuffle: false,
  repeat: 'off',
})

const BAND: RenderInput<'AbovePrompt'> = {
  component: 'AbovePrompt',
  surface: 'terminal',
  requestId: 'above-prompt',
  viewport: { columns: 160, rows: 40 },
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 160,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
}

/** The hint line under the prompt, where compact draws. */
const HINT: RenderInput<'PromptHint'> = {
  component: 'PromptHint',
  surface: 'terminal',
  requestId: 'prompt-hint',
  viewport: { columns: 160, rows: 40 },
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
}

const SESSION = { cwd: '/work', surface: 'terminal', isInteractive: true } as const

const player = (args = '') =>
  ({
    command: 'player',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  }) as const

/**
 * A 2x2 cover as `bin/player art` packs it: two half-block cells, each a
 * little-endian u32 triplet [U+2580, fg, bg] — red over green, blue over white.
 */
const ART_CELLS = ((): string => {
  const words = Uint32Array.of(0x2580, 0xff0000, 0x00ff00, 0x2580, 0x0000ff, 0xffffff)
  const bytes = new Uint8Array(words.buffer)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
})()

const ART = JSON.stringify({ columns: 2, rows: 1, cells: ART_CELLS })

function world(on: On, status = PLAYING, art = ART) {
  const runs: (readonly string[])[] = []
  const statuses: (string | undefined)[] = []
  const commands: string[] = []

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => {
    commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('process.run', ($, e) => {
    runs.push(e.argv)
    const verb = e.argv[1]
    if (verb === 'art') {
      return { value: { exitCode: 0, stdout: art, stderr: '' } }
    }
    if (verb === 'search' || verb === 'catalog' || verb === 'playlists') {
      return { value: { exitCode: 0, stdout: `${verb} said: 1  Monster — Lady Gaga`, stderr: '' } }
    }
    if (verb === 'play' && e.argv[2] === 'elsewhere') {
      return { value: { exitCode: 0, stdout: 'not in your library: Bohemian Rhapsody — Queen\nopened in Music.app — press play there', stderr: '' } }
    }
    if (verb === 'play' && e.argv[2] === 'unclear') {
      return { value: { exitCode: 0, stdout: "'unclear' is ambiguous — pick one:\n 1   Monster — Lady Gaga\n 2   Monster — EXO", stderr: '' } }
    }
    if (verb === 'play' && e.argv[2] === 'nothing') {
      return { value: { exitCode: 1, stdout: "no match for 'nothing'", stderr: '' } }
    }
    return { value: { exitCode: 0, stdout: status, stderr: '' } }
  })
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.status', ($, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  const clock = mock.clock(on)

  return { runs, statuses, commands, clock }
}

const verbs = (runs: (readonly string[])[]) => runs.map(argv => argv[1])

describe('player band', () => {
  test('registers /player and polls Music.app every second', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    expect(w.commands).toEqual(['player'])

    await w.clock.advance(1000)
    await w.clock.settle()
    expect(w.runs[0]?.[0]).toMatch(/\/bin\/player$/)
    expect(verbs(w.runs)).toEqual(['status'])
    expect(w.statuses.at(-1), 'the status row shows the track while the band is hidden').toContain('LOVE ATTACK')
  })

  test('the band is not drawn until /player', async ($, on) => {
    const w = world(on)
    let engineDrew = false

    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      engineDrew = true
      const { Text } = $.ui.resolve(e)
      return h(Text, {}, 'beneath') as RenderElement
    })

    await $.session.start(SESSION)
    await w.clock.settle()
    await $.ui.render(BAND)
    expect(engineDrew, 'passed through to the hooks beneath').toBe(true)
  })

  test('/player shows the band with the track and click-only buttons', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    const { text } = await $.command.run(player())
    await w.clock.settle()

    expect(text, 'the band itself is the answer; a line per toggle is noise').toBeUndefined()
    expect(w.statuses.at(-1), 'the status row clears while the band shows').toBeUndefined()

    const drawn = JSON.stringify(await $.ui.render(BAND))
    expect(drawn).toContain('LOVE ATTACK')
    expect(drawn).toContain('리센느')
    expect(drawn).toContain('1:22 / 3:01')
    expect(drawn, 'digit hotkeys would collide with typing numbers').not.toContain('"hotkey"')
    expect(drawn, 'plain buttons have no clickable chrome').not.toContain('"plain"')
  })

  test('the cover is drawn as a Raster beside the track', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await $.command.run(player())
    await w.clock.advance(1000)
    await w.clock.settle()

    expect(verbs(w.runs), 'the band asks for the artwork once the track is known').toContain('art')
    const artRun = w.runs.find(argv => argv[1] === 'art')
    expect(artRun?.[2], 'twelve columns wide — a square cover four rows tall').toBe('12')

    const drawn = JSON.stringify(await $.ui.render(BAND))
    expect(drawn).toContain('Raster')
    expect(drawn).toContain(JSON.parse(ART).cells)
  })

  test('the rows beside the cover carry the byline and the volume', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await $.command.run(player())
    await w.clock.advance(1000)
    await w.clock.settle()

    const drawn = JSON.stringify(await $.ui.render(BAND))
    expect(drawn, 'the artist and album get their own row').toContain('리센느 — SCENEDROME - EP')
    expect(drawn, 'the volume gets a meter, not just a number').toContain('vol 100')
    expect(drawn, 'meters use block glyphs the cover proves the font has').toContain('█')
    expect(drawn, 'U+25AE fell back to tofu in a real session').not.toContain('▮')
    expect(drawn, 'U+25AF fell back to tofu in a real session').not.toContain('▯')
  })

  test('a meter draws its filled half undimmed so the level reads', async ($, on) => {
    // Dimming the whole bar as one string washed the two glyphs into a single
    // grey slab on a real terminal — the progress was there but unreadable.
    const w = world(on)

    await $.session.start(SESSION)
    await $.command.run(player())
    await w.clock.advance(1000)
    await w.clock.settle()

    const drawn = JSON.stringify(await $.ui.render(BAND))
    expect(drawn, 'the filled run keeps the foreground colour').toContain(
      '{"type":"Text","children":["███████"]}',
    )
    expect(drawn, 'and only the remainder is dimmed').toContain(
      '{"type":"Text","props":{"dimColor":true},"children":["░░░░░░░░░"]}',
    )
  })

  test('the rows sit beside the cover instead of stretching to the edge', async ($, on) => {
    // Pushed apart with space-between across 150 columns, the title and its
    // clock stopped reading as a pair and the band became scattered pieces.
    const w = world(on)

    await $.session.start(SESSION)
    await $.command.run(player())
    await w.clock.advance(1000)
    await w.clock.settle()

    const drawn = JSON.stringify(await $.ui.render(BAND))
    expect(drawn, 'nothing is pushed to the far edge').not.toContain('space-between')
  })

  test('a meter stays full width when the CLI reports nonsense', async ($, on) => {
    // parseTrack casts the CLI's JSON without checking types, so a volume that
    // is not a number reaches the meter and divides to NaN.
    const odd = JSON.stringify({ ...JSON.parse(PLAYING), volume: 'loud' })
    const w = world(on, odd)

    await $.session.start(SESSION)
    await $.command.run(player())
    await w.clock.advance(1000)
    await w.clock.settle()

    const drawn = JSON.stringify(await $.ui.render(BAND))
    // The meter is now two Texts, so match the row that carries the volume:
    // an empty filled half, the full remainder, and then the label. Eight is
    // `DENSITIES.normal.volumeMeter` — the hooks module is loaded by the
    // harness rather than imported, so the width is spelled out here.
    expect(drawn, 'a NaN ratio must not collapse the meter and shift the row').toContain(
      `{"type":"Text","children":[""]},{"type":"Text","props":{"dimColor":true},"children":["${'░'.repeat(8)}"]}`,
    )
    expect(drawn, 'and the row still names it').toContain('vol loud')
  })

  test('the artwork is exported once per track, not once per poll', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await $.command.run(player())
    await w.clock.advance(5000)
    await w.clock.settle()

    const artRuns = w.runs.filter(argv => argv[1] === 'art')
    expect(artRuns.length, 'the track never changed, so one export covers it').toBe(1)
  })

  test('a coverless track keeps the band the size a cover gives it', async ($, on) => {
    const w = world(on, PLAYING, '{"columns":0,"rows":0,"cells":""}')

    await $.session.start(SESSION)
    await $.command.run(player())
    await w.clock.advance(1000)
    await w.clock.settle()

    const drawn = JSON.stringify(await $.ui.render(BAND))
    expect(drawn, 'the plate stands in for the cover').toContain('Raster')
    expect(drawn, 'and takes exactly the cover’s room').toContain('"columns":12,"rows":4')
    expect(drawn).toContain('LOVE ATTACK')
  })

  test('the plate is built from glyphs a Raster cell accepts', async ($, on) => {
    const w = world(on, PLAYING, '{"columns":0,"rows":0,"cells":""}')

    await $.session.start(SESSION)
    await $.command.run(player())
    await w.clock.advance(1000)
    await w.clock.settle()

    const drawn = JSON.stringify(await $.ui.render(BAND))
    const cells = /"cells":"([^"]+)"/.exec(drawn)?.[1]
    expect(cells, 'the plate draws a Raster').toBeDefined()

    const bytes = Uint8Array.from(atob(cells ?? ''), ch => ch.charCodeAt(0))
    const words = new Uint32Array(bytes.buffer)
    expect(words.length, '12 x 4 cells, three words each').toBe(12 * 4 * 3)

    // A Raster cell must be one printable width-1 BMP character, so a code
    // point outside the BMP — or an ambiguous-width one like U+266A — is a bug.
    for (let i = 0; i < words.length; i += 3) {
      const code = words[i] ?? 0
      expect(code, `cell ${i / 3} must be a BMP code point`).toBeLessThan(0x10000)
      expect(code, `cell ${i / 3} must be printable`).toBeGreaterThanOrEqual(0x20)
      expect(
        code === 0x266a,
        `cell ${i / 3} uses an ambiguous-width glyph that can shift the plate`,
      ).toBe(false)
    }
  })

  test('a coverless track draws the same rows a covered one does', async ($, on) => {
    // The rows are laid out beside the plate rather than stretched to the
    // terminal's width, so what must not change between a covered track and a
    // coverless one is the rows themselves — same text, same meters, same
    // height — with only the Raster's cells differing.
    const w = world(on, PLAYING, '{"columns":0,"rows":0,"cells":""}')
    await $.session.start(SESSION)
    await $.command.run(player())
    await w.clock.advance(1000)
    await w.clock.settle()
    const drawn = JSON.stringify(await $.ui.render(BAND))

    expect(drawn, 'the plate stands in at the cover’s size').toContain('"columns":12,"rows":4')
    expect(drawn, 'the byline fills the plate’s height').toContain('리센느 — SCENEDROME - EP')
    expect(drawn, 'and so does the volume').toContain('vol 100')
  })

  test('the transport buttons run the CLI', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await $.command.run(player())
    await w.clock.settle()
    await $.ui.render(BAND)

    await $.ui.press({ plugin: 'player', key: 'next' })
    await w.clock.settle()
    expect(verbs(w.runs)).toContain('next')

    await $.ui.press({ plugin: 'player', key: 'play' })
    await w.clock.settle()
    expect(verbs(w.runs)).toContain('toggle')

    await $.ui.press({ plugin: 'player', key: 'vol-' })
    await w.clock.settle()
    const volumeRun = w.runs.find(argv => argv[1] === 'volume')
    expect(volumeRun?.[2]).toBe('95')
  })

  test('/player <song> plays it and /player again hides the band', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    const played = await $.command.run(player('밤편지'))
    await w.clock.settle()
    const playRun = w.runs.find(argv => argv[1] === 'play')
    expect(playRun?.[2]).toBe('밤편지')
    expect(played.text).toContain('LOVE ATTACK')

    const missing = await $.command.run(player('nothing'))
    await w.clock.settle()
    expect(missing.text).toContain('no match')

    const hidden = await $.command.run(player())
    expect(hidden.text, 'hiding says nothing; the status row takes over').toBeUndefined()
    expect(w.statuses.at(-1)).toContain('LOVE ATTACK')
  })

  test('a song outside the library says where it went', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    const { text } = await $.command.run(player('elsewhere'))
    await w.clock.settle()

    expect(text).toContain('opened in Music.app')
  })

  test('a transport word acts instead of being played as a song', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await $.command.run(player('pause'))
    await w.clock.settle()

    const verbs = w.runs.map(a => a[1])
    expect(verbs, 'pause runs the CLI verb, not a search for a song called "pause"')
      .toContain('pause')
    expect(verbs).not.toContain('play')
  })

  test('a transport word carries its argument', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await $.command.run(player('volume 40'))
    await w.clock.settle()

    expect(w.runs.some(a => a[1] === 'volume' && a[2] === '40')).toBe(true)
  })

  test('a listing answers in the transcript and leaves the band alone', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    const { text } = await $.command.run(player('search monster'))
    await w.clock.settle()

    expect(text).toContain('search said')
    expect(w.runs.some(a => a[1] === 'search' && a[2] === 'monster')).toBe(true)
  })

  test('a song with no verb still plays', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await $.command.run(player('밤편지'))
    await w.clock.settle()

    expect(w.runs.some(a => a[1] === 'play' && a[2] === '밤편지')).toBe(true)
  })

  test('an ambiguous query asks instead of guessing', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    const { text } = await $.command.run(player('unclear'))
    await w.clock.settle()

    expect(text).toContain('ambiguous')
  })

  test('/player compact draws on the hint line, not above the prompt', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    const { text } = await $.command.run(player('compact'))
    await w.clock.advance(1000)
    await w.clock.settle()

    expect(text, 'the band redrawing is the answer, as with the toggle').toBeUndefined()
    expect(verbs(w.runs), 'a one-line band has no height to hang a cover on')
      .not.toContain('art')

    const hint = JSON.stringify(await $.ui.render(HINT))
    expect(hint, 'no cover is exported, so none is drawn').not.toContain('Raster')
    expect(hint, 'with no byline row the artist rides the track row').toContain(
      'LOVE ATTACK · 리센느',
    )
    expect(hint, 'the album is what compact drops').not.toContain('SCENEDROME')
    expect(hint, 'and so is the volume').not.toContain('vol 100')
  })

  test('compact leaves the band above the prompt to normal', async ($, on) => {
    const w = world(on)
    let engineDrew = false

    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      engineDrew = true
      const { Text } = $.ui.resolve(e)
      return h(Text, {}, 'beneath') as RenderElement
    })

    await $.session.start(SESSION)
    await $.command.run(player('compact'))
    await w.clock.settle()

    await $.ui.render(BAND)
    expect(engineDrew, 'compact draws under the prompt, so the band is free').toBe(true)
  })

  test('compact keeps the transport and drops the rest of the buttons', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await $.command.run(player('compact'))
    await w.clock.settle()

    const hint = JSON.stringify(await $.ui.render(HINT))
    for (const key of ['prev', 'play', 'next']) {
      expect(hint, `compact keeps ${key}`).toContain(`"key":"${key}"`)
    }
    // Volume, shuffle and repeat are a `/player` command away, and would crowd
    // the single row they would have to share with the title. Hide goes too:
    // the hint line is the engine's own, and compact hands it back by itself
    // when nothing plays.
    for (const key of ['vol-', 'vol+', 'shuffle', 'repeat', 'close']) {
      expect(hint, `compact drops ${key}`).not.toContain(`"key":"${key}"`)
    }
  })

  test('compact hands the hint line back when nothing is playing', async ($, on) => {
    const w = world(on, '{"state":"stopped"}')
    let engineDrew = false

    on('ui.render', { component: 'PromptHint' }, ($, e) => {
      engineDrew = true
      const { Text } = $.ui.resolve(e)
      return h(Text, {}, e.props.hint) as RenderElement
    })

    await $.session.start(SESSION)
    await $.command.run(player('compact'))
    await w.clock.settle()

    await $.ui.render(HINT)
    expect(engineDrew, 'the shortcuts are not lost to a band with nothing to say').toBe(true)
  })

  test('leaving compact exports the cover the wider band needs', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await $.command.run(player('compact'))
    await w.clock.advance(1000)
    await w.clock.settle()
    expect(verbs(w.runs), 'nothing to export while compact').not.toContain('art')

    await $.command.run(player('normal'))
    await w.clock.advance(1000)
    await w.clock.settle()

    const widths = w.runs.filter(a => a[1] === 'art').map(a => a[2])
    expect(widths, 'the track never changed, but the mode did').toEqual(['12'])
  })

  test('a density word is not played as a song', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await $.command.run(player('compact'))
    await w.clock.settle()

    expect(verbs(w.runs), 'there is no song called "compact" to search for').not.toContain('play')
  })

  test('a word that is not a mode is still a song', async ($, on) => {
    // `full` was a density once. Now that it is not, it must fall through to
    // the search like any other word rather than being quietly swallowed.
    const w = world(on)

    await $.session.start(SESSION)
    await $.command.run(player('full'))
    await w.clock.settle()

    expect(w.runs.some(a => a[1] === 'play' && a[2] === 'full')).toBe(true)
  })

  test('the status row carries a meter while the band is hidden', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await w.clock.advance(1000)
    await w.clock.settle()

    const line = w.statuses.at(-1) ?? ''
    expect(line, 'the hidden row is the only place the track shows').toContain('LOVE ATTACK')
    expect(line, 'so it gets a meter as well as the clock').toContain('█')
    expect(line).toContain('1:22/3:01')
  })

  test('a track with no artist leaves out the separator', async ($, on) => {
    const bare = JSON.stringify({ ...JSON.parse(PLAYING), artist: '' })
    const w = world(on, bare)

    await $.session.start(SESSION)
    await w.clock.advance(1000)
    await w.clock.settle()

    expect(w.statuses.at(-1), 'a dangling " · " reads as a missing word').not.toContain(
      'LOVE ATTACK ·',
    )
  })

  test('idle Music.app says so', async ($, on) => {
    const w = world(on, '{"state":"stopped"}')

    await $.session.start(SESSION)
    await $.command.run(player())
    await w.clock.settle()

    const drawn = JSON.stringify(await $.ui.render(BAND))
    expect(drawn).toContain('nothing playing')
  })
})
