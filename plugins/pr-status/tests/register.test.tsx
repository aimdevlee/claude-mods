import type { On, RenderElement, RenderInput, RenderNode } from 'claude-code'
import { describe, expect, mock, test, tier } from 'claude-code/testing'

import {
  buttonsWidthOf,
  checksRowOf,
  clip,
  compactOf,
  linkRowOf,
  linkable,
  parseStatus,
  reviewTextOf,
  threadRowOf,
  titleRowOf,
  widthOf,
} from '../hooks/register'

tier('user')

const URL = 'https://github.com/rails/rails/pull/58767'

/** A pull request under review: checks failing, one approval, one remark open. */
const OPEN = JSON.stringify({
  state: 'open',
  branch: 'public-rate-limiting',
  number: 58767,
  title: 'Make ActionController::RateLimiting#rate_limiting public',
  url: URL,
  author: 'timoschilling',
  base: 'main',
  head: 'public-rate-limiting',
  additions: 123,
  deletions: 20,
  files: 3,
  body: 'rate_limit only applies via a before_action, evaluated before the action runs.',
  checks: {
    state: 'fail',
    total: 12,
    passed: 7,
    failed: 2,
    pending: 1,
    skipped: 2,
    failing: [
      { name: 'rails-new-docker', url: 'https://github.com/rails/rails/actions/runs/1/job/2' },
      { name: 'buildkite/rails', url: 'https://buildkite.com/rails/rails/builds/133653' },
    ],
    running: [{ name: 'rubocop', url: 'https://github.com/rails/rails/actions/runs/1/job/3' }],
  },
  reviews: {
    decision: 'CHANGES_REQUESTED',
    approved: ['nvasilevski'],
    changes: ['adrianna'],
    commented: [],
    requested: ['byroot'],
  },
  threads: {
    unresolved: 3,
    items: [
      {
        path: 'activerecord/lib/active_record/model_schema/schema_context.rb',
        line: 149,
        outdated: false,
        author: 'adrianna',
        text: 'Opting to read the definition off the base class rather than the query constraints list',
        url: `${URL}#discussion_r4010986215`,
      },
    ],
  },
  links: {
    pr: URL,
    checks: `${URL}/checks`,
    files: `${URL}/files`,
    commits: `${URL}/commits`,
  },
})

const NO_PR = JSON.stringify({
  state: 'none',
  reason: 'no pull request for this branch',
  branch: 'pr-band-mod',
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

const at = (columns: number): RenderInput<'AbovePrompt'> => ({
  ...BAND,
  viewport: { columns, rows: 40 },
  props: { ...BAND.props, bodyColumns: columns },
})

const SESSION = { cwd: '/work', surface: 'terminal', isInteractive: true } as const

const pr = (args = '') =>
  ({
    command: 'pr-status',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  }) as const

function world(on: On, status = OPEN) {
  const runs: (readonly string[])[] = []
  const commands: string[] = []

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => {
    commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('process.run', ($, e) => {
    runs.push(e.argv)
    const verb = e.argv[1]
    if (verb === 'status' || verb === 'refresh') {
      return { value: { exitCode: 0, stdout: status, stderr: '' } }
    }
    return { value: { exitCode: 0, stdout: `${verb} said: #58767`, stderr: '' } }
  })
  on('ui.invalidate', () => ({ value: undefined }))
  const clock = mock.clock(on)

  return { runs, commands, clock }
}

const verbs = (runs: (readonly string[])[]) => runs.map(argv => argv[1])

function elements(node: RenderNode | undefined): RenderElement[] {
  if (node === undefined || typeof node === 'string') return []
  return [node, ...('children' in node ? (node.children ?? []).flatMap(elements) : [])]
}

/**
 * Measure the emitted tree, including the host's documented `[ label ]` button
 * chrome and a Link's own text, and fail on any group wider than the width it
 * claimed. A band that overflows does not wrap: it pushes the prompt sideways,
 * which no string-level assertion catches.
 */
function fittedWidth(node: RenderNode | undefined, available: number): number {
  if (node === undefined) return 0
  if (typeof node === 'string') return widthOf(node)
  if (node.type === 'Button') return widthOf(node.props.label) + 4
  if (node.type === 'Link') {
    const children = (node.children ?? []).map(child => fittedWidth(child, available))
    return children.length > 0 ? children.reduce((a, b) => a + b, 0) : widthOf(node.props.label ?? node.props.href)
  }
  if (node.type !== 'Box' && node.type !== 'Text') return 0
  const props = node.props ?? {}
  const width = typeof props.width === 'number' ? props.width : available
  const padding = typeof props.paddingX === 'number' ? props.paddingX * 2 : 0
  const children = node.children ?? []
  const sizes = children.map(child => fittedWidth(child, Math.max(0, width - padding)))
  const gap = typeof props.gap === 'number' ? props.gap : 0
  const content = props.flexDirection === 'column'
    ? Math.max(0, ...sizes)
    : sizes.reduce((a, b) => a + b, 0) + Math.max(0, sizes.length - 1) * gap
  expect(content + padding, `${node.type} must fit ${width} cells`).toBeLessThanOrEqual(width)
  return typeof props.width === 'number' ? props.width : content + padding
}

describe('reading what gh answered', () => {
  test('a half-filled object is filled out rather than thrown away', () => {
    const status = parseStatus('{"state":"open","number":7,"title":"x"}')
    expect(status.number).toBe(7)
    expect(status.checks.failing).toEqual([])
    expect(status.threads.unresolved).toBe(0)
    expect(status.links.pr).toBe('')
  })

  test('anything that is not a pull request reads as none', () => {
    for (const text of ['', 'gh: not found', '[]', 'null', '{"branch":"main"}']) {
      expect(parseStatus(text).state, `"${text}"`).toBe('none')
    }
  })

  test('only an href the engine will carry becomes a Link', () => {
    const cases: [string, boolean][] = [
      ['https://github.com/rails/rails/pull/1', true],
      ['https://buildkite.com/rails/rails/builds/133653', true],
      ['http://github.com/rails/rails/pull/1', false],
      ['https://example.com/한글', false],
      ['https://example.com/a b', false],
      ['', false],
    ]
    for (const [href, want] of cases) expect(linkable(href), href).toBe(want)
  })
})

describe('fitting the rows', () => {
  test('the review word says what is being asked of you, changes before praise', () => {
    const base = parseStatus(OPEN).reviews
    const cases: [Partial<typeof base>, string][] = [
      [{ changes: ['a'], approved: ['b', 'c'] }, 'changes'],
      [{ changes: ['a', 'b'] }, 'changes 2'],
      [{ changes: [], approved: ['b'] }, 'approved'],
      [{ changes: [], approved: ['b', 'c'] }, 'approved 2'],
      [{ changes: [], approved: [], requested: ['d', 'e'] }, 'waiting 2'],
      [{ changes: [], approved: [], requested: [] }, ''],
    ]
    for (const [reviews, want] of cases) {
      const status = { ...parseStatus(OPEN), reviews: { ...base, ...reviews } }
      expect(reviewTextOf(status), JSON.stringify(reviews)).toBe(want)
    }
  })

  test('every row keeps inside its width at any terminal size', () => {
    const status = parseStatus(OPEN)
    for (let columns = 0; columns <= 200; columns += 1) {
      const strip = buttonsWidthOf(columns)
      const compact = compactOf(status, columns, 1)
      const parts = [compact.badge, compact.number, compact.title, compact.checks, compact.review, compact.threads]
      const shown = parts.filter(part => part !== '')
      const spent =
        shown.reduce((n, part) => n + widthOf(part), 0) +
        strip +
        Math.max(0, shown.length + (strip > 0 ? 1 : 0) - 1)
      expect(spent, `compact at ${columns}`).toBeLessThanOrEqual(columns)

      const title = titleRowOf(status, columns)
      const titled = [title.badge, title.number, title.title, title.size].filter(p => p !== '')
      expect(
        titled.reduce((n, part) => n + widthOf(part), 0) + Math.max(0, titled.length - 1),
        `title at ${columns}`,
      ).toBeLessThanOrEqual(columns)

      const checks = checksRowOf(status, columns)
      expect(
        widthOf(checks.counts) + checks.named.reduce((n, c) => n + widthOf(c.name) + 1, 0),
        `checks at ${columns}`,
      ).toBeLessThanOrEqual(Math.max(widthOf(checks.counts), columns))

      const links = linkRowOf(status, columns)
      expect(
        links.reduce((n, l, i) => n + widthOf(l.name) + (i === 0 ? 0 : 1), 0),
        `links at ${columns}`,
      ).toBeLessThanOrEqual(columns)
    }
  })

  test('the title survives the summaries, which drop least-useful-first', () => {
    const status = parseStatus(OPEN)
    const wide = compactOf(status, 160, 1)
    expect(wide.checks).toBe('✓ 7 × 2 ⋯ 1')
    expect(wide.threads).toBe('3 unresolved')
    expect(wide.review).toBe('changes')

    // Narrowing drops the review word before the count of unresolved remarks,
    // and the checks last: the two that ask for work outlive the one that does
    // not, and the title is never squeezed below a readable scrap.
    const middle = compactOf(status, 60, 1)
    expect(middle.review).toBe('')
    expect(middle.checks).not.toBe('')
    expect(widthOf(middle.title)).toBeGreaterThanOrEqual(12)
  })

  test('a remark names its file by basename and counts the rest', () => {
    const status = parseStatus(OPEN)
    const row = threadRowOf(status, 80)
    expect(row?.where).toBe('schema_context.rb:149')
    expect(row?.more).toBe('+2')
    expect(row?.url).toContain('#discussion_r')
    expect(threadRowOf({ ...status, threads: { unresolved: 0, items: [] } }, 80)).toBeUndefined()
  })

  test('long titles keep whole graphemes', () => {
    expect(clip('勤怠打刻の丸め', 5)).toBe('勤怠…')
    expect(clip('e\u0301clair', 3)).toBe('e\u0301c…')
    expect(clip('title\nwrapped', 20)).toBe('title wrapped')
  })
})

describe('the band', () => {
  test('registers /pr-status and polls the CLI on a clock', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    expect(w.commands).toEqual(['pr-status'])

    await w.clock.advance(5000)
    await w.clock.settle()
    expect(w.runs[0]?.[0]).toMatch(/\/bin\/pr-status$/)
    expect(verbs(w.runs)).toEqual(['status'])
  })

  test('a branch with a pull request shows it without a command being run', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await w.clock.advance(5000)
    await w.clock.settle()

    const drawn = JSON.stringify(await $.ui.render(BAND))
    expect(drawn, 'compact is the resting state').toContain('#58767')
    expect(drawn).toContain('✓ 7 × 2 ⋯ 1')
    expect(w.commands, 'and nothing had to be typed').toEqual(['pr-status'])
  })

  test('a branch with no pull request draws nothing at all', async ($, on) => {
    const w = world(on, NO_PR)
    let engineDrew = false

    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      engineDrew = true
      const { Text } = $.ui.resolve(e)
      return h(Text, {}, 'beneath') as RenderElement
    })

    await $.session.start(SESSION)
    await w.clock.advance(5000)
    await w.clock.settle()

    await $.ui.render(BAND)
    expect(engineDrew, 'nothing to say, so the row is given back').toBe(true)
  })

  test('/pr-status opens the full band: checks, review, remarks and a link per screen', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await w.clock.advance(5000)
    await w.clock.settle()
    await $.command.run(pr())
    await w.clock.settle()

    const drawn = await $.ui.render(BAND)
    const text = JSON.stringify(drawn)
    expect(text).toContain('timoschilling')
    expect(text).toContain('public-rate-limiting → main')
    expect(text, 'the description, not only the title').toContain('rate_limit only applies')
    expect(text).toContain('rails-new-docker')
    expect(text).toContain('changes @adrianna')
    expect(text).toContain('schema_context.rb:149')

    const links = elements(drawn).filter(node => node.type === 'Link')
    const hrefs = links.map(node => node.props.href)
    expect(hrefs, 'the pull request itself').toContain(URL)
    expect(hrefs, 'its checks').toContain(`${URL}/checks`)
    expect(hrefs, 'its files').toContain(`${URL}/files`)
    expect(hrefs, 'its commits').toContain(`${URL}/commits`)
    expect(hrefs, 'the remark, not merely the conversation').toContain(`${URL}#discussion_r4010986215`)
    expect(hrefs, 'and the failing check it came from').toContain(
      'https://github.com/rails/rails/actions/runs/1/job/2',
    )
  })

  test('a check URL the engine would refuse is drawn as plain words', async ($, on) => {
    const refused = JSON.parse(OPEN)
    refused.checks.failing = [{ name: 'jenkins', url: 'http://ci.internal/job/1' }]
    const w = world(on, JSON.stringify(refused))

    await $.session.start(SESSION)
    await w.clock.advance(5000)
    await w.clock.settle()
    await $.command.run(pr())
    await w.clock.settle()

    const drawn = await $.ui.render(BAND)
    const hrefs = elements(drawn).filter(n => n.type === 'Link').map(n => n.props.href)
    expect(hrefs, 'an href the engine refuses would take the whole tree down').not.toContain(
      'http://ci.internal/job/1',
    )
    expect(JSON.stringify(drawn), 'the name still shows').toContain('jenkins')
  })

  test('both densities fit the terminal they are drawn in', async ($, on) => {
    const w = world(on)
    // A terminal too narrow for even the number gives the row back, so there
    // has to be something beneath the band to answer for it.
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return h(Text, {}, '') as RenderElement
    })
    await $.session.start(SESSION)
    await w.clock.advance(5000)
    await w.clock.settle()

    for (let columns = 0; columns <= 200; columns += 1) {
      fittedWidth(await $.ui.render(at(columns)), columns)
    }

    await $.command.run(pr())
    await w.clock.settle()
    for (let columns = 0; columns <= 200; columns += 1) {
      fittedWidth(await $.ui.render(at(columns)), columns)
    }
  })

  test('the full band says so when the branch has no pull request', async ($, on) => {
    const w = world(on, NO_PR)

    await $.session.start(SESSION)
    await w.clock.advance(5000)
    await w.clock.settle()
    await $.command.run(pr())
    await w.clock.settle()

    expect(JSON.stringify(await $.ui.render(BAND))).toContain('no pull request for this branch')
  })

  test('/pr-status again folds the band back to the compact row', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await w.clock.advance(5000)
    await w.clock.settle()

    await $.command.run(pr())
    await w.clock.settle()
    expect(JSON.stringify(await $.ui.render(BAND))).toContain('timoschilling')

    await $.command.run(pr())
    await w.clock.settle()
    const folded = JSON.stringify(await $.ui.render(BAND))
    expect(folded, 'compact keeps the number').toContain('#58767')
    expect(folded, 'and loses the byline').not.toContain('timoschilling')
  })

  test('the size button is the same move as typing /pr-status', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await w.clock.advance(5000)
    await w.clock.settle()

    await $.ui.render(BAND)
    await $.ui.press({ plugin: 'pr-status', key: 'size' })
    expect(JSON.stringify(await $.ui.render(BAND))).toContain('timoschilling')

    await $.ui.press({ plugin: 'pr-status', key: 'size' })
    expect(JSON.stringify(await $.ui.render(BAND))).not.toContain('timoschilling')
  })

  test('the refresh button asks the CLI to go past its cache', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await w.clock.advance(5000)
    await w.clock.settle()

    await $.ui.render(BAND)
    await $.ui.press({ plugin: 'pr-status', key: 'refresh' })
    await w.clock.settle()
    expect(verbs(w.runs)).toContain('refresh')
  })

  test('a reading verb prints the CLI and leaves the band alone', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await w.clock.settle()

    const { text } = await $.command.run(pr('comments'))
    expect(text).toBe('comments said: #58767')
    expect(verbs(w.runs)).toContain('comments')
  })

  test('/pr-status <number> pins the band to another pull request', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await w.clock.settle()

    await $.command.run(pr('12345'))
    await w.clock.settle()
    expect(w.runs.some(argv => argv[1] === 'refresh' && argv[2] === '12345')).toBe(true)

    await w.clock.advance(5000)
    await w.clock.settle()
    expect(w.runs.some(argv => argv[1] === 'status' && argv[2] === '12345'), 'the poll stays pinned').toBe(true)

    await $.command.run(pr('branch'))
    await w.clock.advance(5000)
    await w.clock.settle()
    expect(w.runs.some(argv => argv[1] === 'status' && argv[2] === undefined)).toBe(true)
  })

  test('/pr-status close leaves the compact row behind, not an empty band', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await w.clock.advance(5000)
    await w.clock.settle()

    await $.command.run(pr())
    await $.command.run(pr('close'))
    await w.clock.settle()
    expect(JSON.stringify(await $.ui.render(BAND)), 'closing is not hiding').toContain('#58767')
  })
})
