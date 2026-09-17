/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import type { EngineInterface, Register } from 'claude-code'

/**
 * The pull request for the branch you are on, drawn directly above the prompt.
 * `bin/pr status` is polled and the band redraws; `/pr` opens the full band and
 * closes it again. Every screen the band names — the pull request, its checks,
 * its files, its commits and each unresolved remark — is a hyperlink, so the
 * band is a way into GitHub rather than a copy of it.
 *
 * Two densities, with the branch deciding whether either is drawn at all:
 *
 *   compact  one row — the number, the title, the checks, where the review
 *            stands and how much is unresolved. It is the resting state: a
 *            session on a branch that has a pull request shows it without a
 *            command being run, and a branch with none draws nothing.
 *   normal   the band — the byline, the description's first line, the checks
 *            with the failing ones named, who reviewed, the newest unresolved
 *            remark and the row of links. `/pr` opens it, `/pr` folds it back.
 *
 * The poll is cheap because `bin/pr` caches: its key carries the commit HEAD
 * points at, so a push answers fresh at once and a TTL covers CI moving while
 * the commit stands still. This hook therefore polls on a clock and lets the
 * CLI decide when that costs a request.
 *
 * Every row's width is spent before it is drawn, gaps included, because a Box
 * that overflows the band does not wrap — it pushes the prompt sideways.
 */

const COMMAND = 'pr'

// The CLI answers from its own cache, so this is how often the band may notice
// a change, not how often GitHub is asked.
const POLL_MS = 5000

// Verbs whose own output is the answer: printed into the transcript, the band
// left as it is. Anything else `/pr` is given is a pull request to pin to.
const LISTING = new Set(['show', 'body', 'checks', 'reviews', 'comments', 'files', 'diff', 'web'])

/**
 * The state the CLI reports, and the mark the band draws for it. One family of
 * circles: filling as the pull request moves, whole once it is merged, struck
 * through when it was closed instead. Each is in the coding font's own cmap —
 * a glyph that is not falls back to some other font, at some other width.
 */
const BADGES = { open: '◔', draft: '◌', merged: '●', closed: '⊘', none: '·' } as const

// The label column of the band's lower rows. Aligned, so checks, review and
// threads read as one list rather than as three sentences.
const LABEL = 8

// Every row inside the band separates its parts by one cell.
const ROW_GAP = 1

export type Density = 'compact' | 'normal'

const isDensity = (word: string): word is Density => word === 'compact' || word === 'normal'

export type Check = { name: string; url: string }

export type Thread = {
  path: string
  line: number
  outdated: boolean
  author: string
  text: string
  url: string
}

export type Status = {
  state: 'open' | 'draft' | 'merged' | 'closed' | 'none'
  reason?: string
  branch: string
  number: number
  title: string
  url: string
  author: string
  base: string
  head: string
  additions: number
  deletions: number
  files: number
  body: string
  checks: {
    state: 'pass' | 'fail' | 'pending' | 'none'
    total: number
    passed: number
    failed: number
    pending: number
    skipped: number
    failing: Check[]
    running: Check[]
  }
  reviews: {
    decision: string
    approved: string[]
    changes: string[]
    commented: string[]
    requested: string[]
  }
  threads: { unresolved: number; items: Thread[] }
  links: { pr: string; checks: string; files: string; commits: string }
}

type Host = {
  run: (...args: string[]) => Promise<string>
  invalidate: () => void
  every: EngineInterface['clock']['every']
}

export const NONE: Status = {
  state: 'none',
  branch: '',
  number: 0,
  title: '',
  url: '',
  author: '',
  base: '',
  head: '',
  additions: 0,
  deletions: 0,
  files: 0,
  body: '',
  checks: {
    state: 'none', total: 0, passed: 0, failed: 0, pending: 0, skipped: 0, failing: [], running: [],
  },
  reviews: { decision: '', approved: [], changes: [], commented: [], requested: [] },
  threads: { unresolved: 0, items: [] },
  links: { pr: '', checks: '', files: '', commits: '' },
}

/**
 * The CLI's JSON, filled out to a whole Status. It answers `{state:"none"}`
 * with a reason and nothing else whenever there is no pull request to describe,
 * so the rest is defaulted here once instead of being guarded at each use.
 */
export function parseStatus(text: string): Status {
  try {
    const parsed: unknown = JSON.parse(text.trim())
    if (typeof parsed !== 'object' || parsed === null || !('state' in parsed)) return NONE
    const pr = parsed as Partial<Status>
    return {
      ...NONE,
      ...pr,
      checks: { ...NONE.checks, ...pr.checks },
      reviews: { ...NONE.reviews, ...pr.reviews },
      threads: { ...NONE.threads, ...pr.threads },
      links: { ...NONE.links, ...pr.links },
    }
  } catch {
    // not JSON: gh is not answering, and a band drawing nothing says so
    return NONE
  }
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

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const clean = (text: string) => text.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g, ' ')
const graphemeWidth = (text: string) => {
  if (/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(text)) return 2
  return [...text].reduce((n, ch) => n + (/\p{Mark}|\u200d/u.test(ch) ? 0 : cellWidth(ch)), 0)
}

export const widthOf = (text: string) =>
  [...graphemes.segment(text)].reduce((n, { segment }) => n + graphemeWidth(segment), 0)

export function clip(text: string, width: number): string {
  text = clean(text)
  if (width <= 0) return ''
  if (widthOf(text) <= width) return text
  let out = ''
  let used = 0
  for (const { segment } of graphemes.segment(text)) {
    const w = graphemeWidth(segment)
    if (used + w > width - 1) break
    out += segment
    used += w
  }
  return out + '…'
}

/**
 * Whether a URL may be handed to a Link. The engine refuses the whole tree over
 * an href it will not carry, which would take the band down with it — and these
 * come from wherever a check posted its status, not only from GitHub.
 */
export function linkable(href: string): boolean {
  return /^https:\/\/[\x21-\x7e]{1,2040}$/.test(href)
}

export const badgeOf = (pr: Status) => BADGES[pr.state]

/** `✓ 7 × 2 ⋯ 1` — passed always, the other two only when there are any. */
export function checksTextOf(pr: Status): string {
  const checks = pr.checks
  if (checks.state === 'none') return ''
  const parts = [`✓ ${checks.passed}`]
  if (checks.failed > 0) parts.push(`× ${checks.failed}`)
  if (checks.pending > 0) parts.push(`⋯ ${checks.pending}`)
  return parts.join(' ')
}

/**
 * Where the review stands, in a word or two. Changes requested outranks an
 * approval: it is the one asking something of you, and a pull request can
 * carry both at once.
 */
export function reviewTextOf(pr: Status): string {
  const { approved, changes, requested } = pr.reviews
  if (changes.length > 0) return changes.length > 1 ? `changes ${changes.length}` : 'changes'
  if (approved.length > 0) return approved.length > 1 ? `approved ${approved.length}` : 'approved'
  if (requested.length > 0) return `waiting ${requested.length}`
  return ''
}

export function threadsTextOf(pr: Status): string {
  return pr.threads.unresolved > 0 ? `${pr.threads.unresolved} unresolved` : ''
}

/** `+123 −20  3 files` — the size of the change, as the title row's right end. */
export function sizeTextOf(pr: Status): string {
  return `+${pr.additions} −${pr.deletions}  ${pr.files} file${pr.files === 1 ? '' : 's'}`
}

// A Button draws its label inside the host's `[ ]` chrome.
const buttonWidth = (label: string) => widthOf(label) + 4
const BOTH_BUTTONS = buttonWidth('↻') + 1 + buttonWidth('▲')
const SIZE_BUTTON = buttonWidth('▲')

// The badge, a number and a scrap of title: what a row keeps before a button
// may take any of its width.
const MIN_TITLE = 12

// Below this a remark is more ellipsis than words, so the row shows where it is
// and leaves what it says to the link.
const MIN_REMARK = 8
const HEAD_ROOM = 1 + 6 + MIN_TITLE

/**
 * How wide the button strip is at this width — which is also which buttons are
 * drawn, since each is a different width. One function, so a row's arithmetic
 * and its rendering cannot disagree about how much it spent.
 */
export function buttonsWidthOf(columns: number): number {
  if (columns >= HEAD_ROOM + BOTH_BUTTONS) return BOTH_BUTTONS
  if (columns >= HEAD_ROOM + SIZE_BUTTON) return SIZE_BUTTON
  return 0
}

/**
 * The badge and the number with the gap between them: the least either density
 * can draw, and so the width below which the band gives the row back rather
 * than drawing something that does not fit in it.
 */
export function headRoomOf(pr: Status, gap: number): number {
  return widthOf(badgeOf(pr)) + gap + widthOf(`#${pr.number}`)
}

/**
 * The compact row, fitted to `columns`: the badge and the number always, then
 * the title, then as many of the three summaries as still leave the title room.
 *
 * They are kept in the order they cost you something — a failing check and an
 * unresolved remark ask for work, while the review word is most often only
 * "waiting" — so a narrowing terminal loses the least useful part first.
 */
export function compactOf(pr: Status, columns: number, gap: number): {
  badge: string
  number: string
  title: string
  checks: string
  review: string
  threads: string
} {
  const badge = badgeOf(pr)
  const number = `#${pr.number}`
  // Below the badge and the number the row has nothing left to say, so it says
  // nothing: an overflowing Box does not wrap, it pushes the prompt sideways.
  if (columns < headRoomOf(pr, gap)) {
    return { badge: '', number: '', title: '', checks: '', review: '', threads: '' }
  }
  const texts = {
    checks: checksTextOf(pr),
    threads: threadsTextOf(pr),
    review: reviewTextOf(pr),
  }
  const buttons = buttonsWidthOf(columns)
  // The head, the gap before the title, and the strip with a gap of its own.
  let used = headRoomOf(pr, gap) + gap + buttons + (buttons > 0 ? gap : 0)
  const kept = new Set<keyof typeof texts>()
  for (const name of ['checks', 'threads', 'review'] as const) {
    const text = texts[name]
    if (text === '') continue
    const need = widthOf(text) + gap
    if (columns - used - need < MIN_TITLE) continue
    used += need
    kept.add(name)
  }
  return {
    badge,
    number,
    title: clip(pr.title, Math.max(0, columns - used)),
    checks: kept.has('checks') ? texts.checks : '',
    review: kept.has('review') ? texts.review : '',
    threads: kept.has('threads') ? texts.threads : '',
  }
}

/**
 * The band's first row: the badge, the number and the title on the left, the
 * size of the change on the right. The size is short and fixed, so it is
 * measured first and the title takes whatever is left.
 */
export function titleRowOf(pr: Status, columns: number): {
  badge: string
  number: string
  title: string
  size: string
} {
  const badge = badgeOf(pr)
  const number = `#${pr.number}`
  // As in the compact row: below the badge and the number there is no band to
  // draw, and an empty badge is how the caller is told so.
  if (columns < headRoomOf(pr, ROW_GAP)) return { badge: '', number: '', title: '', size: '' }
  const size = sizeTextOf(pr)
  const room = columns - headRoomOf(pr, ROW_GAP) - ROW_GAP
  // The size joins the row only if the title still reads afterwards; a band too
  // narrow for both keeps the title, which is what the row is for.
  const keepsSize = room - widthOf(size) - ROW_GAP >= MIN_TITLE
  return {
    badge,
    number,
    title: clip(pr.title, Math.max(0, keepsSize ? room - widthOf(size) - ROW_GAP : room)),
    size: keepsSize ? size : '',
  }
}

/** `@author · head → base`, and the state once it is no longer simply open. */
export function bylineOf(pr: Status, columns: number): string {
  const parts = [pr.author === '' ? '' : `@${pr.author}`, `${pr.head} → ${pr.base}`]
  if (pr.state !== 'open') parts.push(pr.state)
  return clip(parts.filter(Boolean).join('  ·  '), columns)
}

/**
 * The checks row: the counts, then the names worth opening — the failing ones,
 * or the running ones when nothing has failed. Each name is drawn as its own
 * link, so only those that still fit are handed back.
 *
 * `columns` is what the row has after its label and the gap behind it.
 */
export function checksRowOf(pr: Status, columns: number): { counts: string; named: Check[] } {
  const counts = checksTextOf(pr)
  // Clipped counts would read as a different tally, so the row goes instead.
  if (counts === '' || widthOf(counts) > columns) return { counts: '', named: [] }
  const source = pr.checks.failing.length > 0 ? pr.checks.failing : pr.checks.running
  let room = columns - widthOf(counts)
  const named: Check[] = []
  for (const check of source) {
    const need = widthOf(check.name) + ROW_GAP
    if (room - need < 0) break
    room -= need
    named.push(check)
  }
  return { counts, named }
}

/** Who has answered, and who is still being waited on. */
export function reviewRowOf(pr: Status, columns: number): string {
  const { approved, changes, commented, requested } = pr.reviews
  const at = (who: string[]) => who.map(name => `@${name}`).join(' ')
  const parts = [
    changes.length > 0 ? `changes ${at(changes)}` : '',
    approved.length > 0 ? `approved ${at(approved)}` : '',
    commented.length > 0 ? `commented ${at(commented)}` : '',
    requested.length > 0 ? `waiting ${at(requested)}` : '',
  ].filter(Boolean)
  if (parts.length === 0) return clip(pr.reviews.decision.toLowerCase().replace(/_/g, ' '), columns)
  return clip(parts.join('  ·  '), columns)
}

/**
 * The newest unresolved remark, and how many more are waiting behind it.
 *
 * The file is named by its basename: no band is wide enough for
 * `activerecord/lib/active_record/model_schema/schema_context.rb`, and the link
 * goes to the remark itself, so the whole path is one click away.
 */
export function threadRowOf(pr: Status, columns: number): {
  where: string
  url: string
  text: string
  more: string
} | undefined {
  const [first] = pr.threads.items
  if (first === undefined) return undefined
  const base = first.path.split('/').pop() ?? ''
  const where = base === '' ? 'conversation' : `${base}:${first.line}`
  // The link is the row's point, and a clipped file name is not one you can
  // recognise, so a row that cannot carry it whole is not drawn.
  if (widthOf(where) > columns) return undefined
  // What is left after the link, spent on the count of the others and then on
  // the remark itself. Each part is dropped rather than squeezed: a lone `…`
  // where the remark was says less than the row does without it.
  let room = columns - widthOf(where)
  const rest = pr.threads.unresolved - 1
  const more = rest > 0 && room >= widthOf(`+${rest}`) + ROW_GAP ? `+${rest}` : ''
  if (more !== '') room -= widthOf(more) + ROW_GAP
  const who = first.author === '' ? '' : `@${first.author}`
  const said = `${who} ${first.text}`.trim()
  return {
    where,
    url: first.url,
    text: room - ROW_GAP >= MIN_REMARK ? clip(said, room - ROW_GAP) : '',
    more,
  }
}

/**
 * The screens the band links to, in the order they are worked through, dropping
 * the ones the row cannot carry. `columns` is what is left after the label, the
 * gap behind it and the button strip.
 */
export function linkRowOf(pr: Status, columns: number): Check[] {
  const all = [
    { name: 'pr', url: pr.links.pr },
    { name: 'checks', url: pr.links.checks },
    { name: 'files', url: pr.links.files },
    { name: 'commits', url: pr.links.commits },
  ].filter(link => linkable(link.url))
  const kept: Check[] = []
  let room = columns
  for (const link of all) {
    const need = widthOf(link.name) + (kept.length === 0 ? 0 : ROW_GAP)
    if (room - need < 0) break
    room -= need
    kept.push(link)
  }
  return kept
}

/**
 * Reserve the padding before any text is fitted, the way the band's own Box
 * spends it, and leave the right edge to the engine's collapse mark (`[-]`).
 */
export function layoutOf(bodyColumns: number) {
  const outer = Math.max(0, Math.floor(bodyColumns) - 6)
  const padding = outer >= 4 ? 1 : 0
  return { outer, padding, columns: Math.max(0, outer - padding * 2) }
}

export const register: Register = on => {
  let host: Host | undefined
  let pr: Status = NONE
  let pinned: number | undefined
  let isShown = false
  let density: Density = 'compact'
  let isPolling = false

  async function poll(engine: Host, fresh = false) {
    if (isPolling) return
    isPolling = true
    try {
      const args = [fresh ? 'refresh' : 'status', ...(pinned === undefined ? [] : [String(pinned)])]
      const next = parseStatus(await engine.run(...args))
      const changed = JSON.stringify(next) !== JSON.stringify(pr)
      pr = next
      if (changed) engine.invalidate()
    } finally {
      isPolling = false
    }
  }

  on('session.start', async ($, e, next) => {
    const cli = `${$.plugin.root}/bin/pr`
    host = {
      run: async (...args) => {
        // A diff can be a large fetch; everything else is two round trips at
        // worst — but both go over the network, so neither is instant.
        const timeoutMs = args[0] === 'diff' ? 60000 : 30000
        const { stdout } = await $.process.run([cli, ...args], { timeoutMs })
        return stdout
      },
      invalidate: () => $.ui.invalidate('ui.render'),
      every: (ms, fn) => $.clock.every(ms, fn),
    }
    await $.command.register({
      name: COMMAND,
      description:
        'The pull request for your branch, above the prompt: a branch that has one shows it as a single row, /pr opens the full band and closes it again, /pr <number> pins the band to another pull request, and show | body | checks | reviews | comments | files | diff | web print into the transcript',
      argumentHint: '[<number> | branch | refresh | compact | normal | show | checks | comments | diff | web]',
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
      // Closing leaves compact behind rather than nothing: it is one row, the
      // least the band can be, and it goes on its own when the branch has no
      // pull request. `/pr compact` is the same thing said explicitly.
      density = 'compact'
      isShown = false
      engine.invalidate()
      return {}
    }

    if (isDensity(query)) {
      density = query
      if (query !== 'compact') isShown = true
      engine.invalidate()
      return {}
    }

    // Back to whatever the branch's own pull request is.
    if (query === 'branch') {
      pinned = undefined
      await poll(engine, true)
      engine.invalidate()
      return {}
    }

    if (query === 'refresh') {
      await poll(engine, true)
      engine.invalidate()
      return pr.state === 'none' ? { text: pr.reason ?? 'no pull request' } : {}
    }

    if (query !== '') {
      const [verb = '', ...rest] = query.split(/\s+/)

      // A question: the CLI's own output is the answer, so print it and leave
      // the band where it is.
      if (LISTING.has(verb)) {
        const out = (await engine.run(verb, ...rest)).trim()
        return { text: out || `nothing for "${query}"` }
      }

      // A number is a pull request to pin the band to, so someone else's review
      // can be watched from the branch you are working on.
      if (/^\d+$/.test(verb)) {
        pinned = Number(verb)
        density = 'normal'
        isShown = true
        await poll(engine, true)
        engine.invalidate()
        return pr.state === 'none' ? { text: pr.reason ?? `no pull request #${verb}` } : {}
      }

      return { text: `unknown: ${query} — try /pr, /pr <number>, /pr show or /pr comments` }
    }

    // Bare `/pr` opens the full band and folds it back to the compact row.
    if (density === 'compact') {
      density = 'normal'
      isShown = true
    } else {
      density = 'compact'
      isShown = false
    }
    engine.invalidate()
    void poll(engine).catch(() => undefined)
    return {}
  })

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    const engine = host
    if (!engine || e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    // Compact appears by itself, so it asks whether there is anything to draw;
    // the full band was asked for, so it draws even to say there is nothing.
    if (density === 'compact' ? pr.state === 'none' : !isShown) return next(e)
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const { outer, padding, columns } = layoutOf(e.props.bodyColumns)

    const strip = buttonsWidthOf(columns)
    const buttons = (
      <Box gap={1}>
        {strip === BOTH_BUTTONS ? (
          <Button
            key="refresh"
            dimColor
            onPress={() => {
              void poll(engine, true).catch(() => undefined)
            }}
          >
            ↻
          </Button>
        ) : null}
        {strip > 0 ? (
          <Button
            key="size"
            dimColor
            onPress={() => {
              density = density === 'compact' ? 'normal' : 'compact'
              isShown = density !== 'compact'
              engine.invalidate()
            }}
          >
            {density === 'compact' ? '▲' : '▼'}
          </Button>
        ) : null}
      </Box>
    )

    // A link the terminal can follow, or the same word drawn plainly when the
    // URL is not one the engine will carry — an external check service posts
    // its own, and a refused href takes the whole tree with it.
    const link = (key: string, href: string, label: string) =>
      linkable(href) ? (
        <Link key={key} href={href}>{label}</Link>
      ) : (
        <Text key={key}>{label}</Text>
      )

    if (density === 'compact') {
      const row = compactOf(pr, columns, ROW_GAP)
      if (row.badge === '') return next(e)
      return (
        <Box width={outer} paddingX={padding} gap={ROW_GAP}>
          <Text>{row.badge}</Text>
          {link('number', pr.links.pr, row.number)}
          {row.title === '' ? null : <Text bold>{row.title}</Text>}
          {row.checks === '' ? null : (
            <Text color={pr.checks.failed > 0 ? 'warning' : undefined} dimColor={pr.checks.failed === 0}>
              {row.checks}
            </Text>
          )}
          {row.review === '' ? null : <Text dimColor>{row.review}</Text>}
          {row.threads === '' ? null : <Text dimColor>{row.threads}</Text>}
          {strip > 0 ? buttons : null}
        </Box>
      )
    }

    if (pr.state === 'none') {
      return (
        <Box width={outer} paddingX={padding} gap={ROW_GAP}>
          <Text dimColor>
            {clip(
              `· ${pr.reason ?? 'no pull request'}`,
              Math.max(0, columns - strip - (strip > 0 ? ROW_GAP : 0)),
            )}
          </Text>
          {strip > 0 ? buttons : null}
        </Box>
      )
    }

    const title = titleRowOf(pr, columns)
    if (title.badge === '') return next(e)
    const inner = Math.max(0, columns - LABEL - ROW_GAP)
    const byline = bylineOf(pr, columns)
    const body = clip(pr.body, columns)
    const checks = checksRowOf(pr, inner)
    const review = reviewRowOf(pr, inner)
    const thread = threadRowOf(pr, inner)
    const links = linkRowOf(pr, Math.max(0, inner - strip - (strip > 0 ? ROW_GAP : 0)))
    const label = (text: string) => <Text dimColor>{text.padEnd(LABEL)}</Text>

    // A row is drawn only when it has something in it: a pull request with no
    // checks and nothing unresolved is four rows, not seven with two blanks.
    return (
      <Box width={outer} paddingX={padding} flexDirection="column">
        <Box gap={ROW_GAP}>
          <Text>{title.badge}</Text>
          {link('number', pr.links.pr, title.number)}
          {title.title === '' ? null : <Text bold>{title.title}</Text>}
          {title.size === '' ? null : <Text dimColor>{title.size}</Text>}
        </Box>
        {byline === '' ? null : <Text dimColor>{byline}</Text>}
        {body === '' ? null : <Text dimColor>{body}</Text>}
        {checks.counts === '' ? null : (
          <Box gap={ROW_GAP}>
            {label('checks')}
            <Text color={pr.checks.failed > 0 ? 'warning' : undefined}>{checks.counts}</Text>
            {checks.named.map(check => link(`check-${check.name}`, check.url, check.name))}
          </Box>
        )}
        {review === '' ? null : (
          <Box gap={ROW_GAP}>
            {label('review')}
            <Text>{review}</Text>
          </Box>
        )}
        {thread === undefined ? null : (
          <Box gap={ROW_GAP}>
            {label('threads')}
            {link('thread', thread.url, thread.where)}
            {thread.text === '' ? null : <Text dimColor>{thread.text}</Text>}
            {thread.more === '' ? null : <Text dimColor>{thread.more}</Text>}
          </Box>
        )}
        <Box gap={ROW_GAP}>
          {label('open')}
          {links.map(one => link(`link-${one.name}`, one.url, one.name))}
          {strip > 0 ? buttons : null}
        </Box>
      </Box>
    )
  })
}
