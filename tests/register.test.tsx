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
    expect(artRun?.[2], 'twenty columns wide').toBe('20')

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
    // The volume meter sits immediately before its label, so match the pair:
    // the position meter's own run of shade would otherwise satisfy this.
    expect(drawn, 'a NaN ratio must not collapse the meter and shift the row').toContain(
      // Eight is `DENSITIES.normal.volumeMeter`; the hooks module is loaded by
      // the harness rather than imported, so the width is spelled out here.
      `${'░'.repeat(8)} vol`,
    )
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
    expect(drawn, 'and takes exactly the cover’s room').toContain('"columns":20,"rows":4')
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
    expect(words.length, '20 x 4 cells, three words each').toBe(20 * 4 * 3)

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

  test('a coverless band keeps the text rows at the same width', async ($, on) => {
    const w = world(on, PLAYING, '{"columns":0,"rows":0,"cells":""}')

    await $.session.start(SESSION)
    await $.command.run(player())
    await w.clock.advance(1000)
    await w.clock.settle()

    const drawn = JSON.stringify(await $.ui.render(BAND))
    // 160 body columns, less 6 for the collapse mark, less the plate's 20 and
    // the gap: the same 132 a real cover leaves, so nothing reflows.
    expect(drawn, 'the text column is measured off the plate, not the full width').toContain(
      '"width":132',
    )
    expect(drawn, 'and the details still fill the plate’s height').toContain(
      '리센느 — SCENEDROME - EP',
    )
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

  test('/player compact draws the small band and moves the artist up a row', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    const { text } = await $.command.run(player('compact'))
    await w.clock.advance(1000)
    await w.clock.settle()

    expect(text, 'the band redrawing is the answer, as with the toggle').toBeUndefined()
    const artRun = w.runs.find(argv => argv[1] === 'art')
    expect(artRun?.[2], 'compact asks for a twelve-column cover').toBe('12')

    const drawn = JSON.stringify(await $.ui.render(BAND))
    expect(drawn, 'with no byline row the artist rides the track row').toContain(
      'LOVE ATTACK · 리센느',
    )
    expect(drawn, 'the album is what compact drops').not.toContain('SCENEDROME')
    expect(drawn, 'and so is the volume row').not.toContain('vol 100')
  })

  test('/player full frames the band and asks for a bigger cover', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await $.command.run(player('full'))
    await w.clock.advance(1000)
    await w.clock.settle()

    const artRun = w.runs.find(argv => argv[1] === 'art')
    expect(artRun?.[2], 'full asks for a twenty-eight-column cover').toBe('28')

    const drawn = JSON.stringify(await $.ui.render(BAND))
    expect(drawn, 'full draws a border').toContain('"borderStyle":"round"')
    expect(drawn, 'and titles it').toContain('APPLE MUSIC')
    expect(drawn, 'the byline stays').toContain('리센느 — SCENEDROME - EP')
  })

  test('changing density re-exports the cover at the new width', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await $.command.run(player())
    await w.clock.advance(1000)
    await w.clock.settle()

    await $.command.run(player('compact'))
    await w.clock.advance(1000)
    await w.clock.settle()

    const widths = w.runs.filter(a => a[1] === 'art').map(a => a[2])
    expect(widths, 'the track never changed, but the mode did').toEqual(['20', '12'])
  })

  test('a density word is not played as a song', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await $.command.run(player('full'))
    await w.clock.settle()

    expect(verbs(w.runs), 'there is no song called "full" to search for').not.toContain('play')
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
