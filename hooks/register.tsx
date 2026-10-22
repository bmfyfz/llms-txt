import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Status, View } from '../types'
import { absolutizeLinks, estimateTokens, isSiteRoot, normalizeTarget, splitPreamble, truncate } from './lib'
import { discover, readPage, type Net, type PageResult, type SiteResult } from './web'

const PANE = 'llms'
// What the pane draws of one document; the tools have their own max_tokens.
const PANE_TOKENS = 15_000
const EXAMPLES = ['hono.dev', 'svelte.dev', 'docs.anthropic.com']

const history = atom({ plugin: 'llms-txt', key: 'history' } as const, [])
const index = atom({ plugin: 'llms-txt', key: 'index' } as const, -1)
const doc = atom({ plugin: 'llms-txt', key: 'doc' } as const, null)
const status = atom({ plugin: 'llms-txt', key: 'status' } as const, 'idle')
const error = atom({ plugin: 'llms-txt', key: 'error' } as const, '')
const pending = atom({ plugin: 'llms-txt', key: 'pending' } as const, '')
const showIssues = atom({ plugin: 'llms-txt', key: 'showIssues' } as const, false)

function net($: EngineInterface): Net {
  return {
    fetch: (url, init) => $.http.fetch(url, init),
    now: () => $.clock.now(),
  }
}

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
const host = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function siteHeader(r: SiteResult): string[] {
  const lines = [
    r.source === 'published'
      ? `Source: ${r.url} (published by the site)`
      : `Source: synthesized — ${r.note ?? `${r.origin} publishes no llms.txt`}`,
    `Size: ~${fmt(r.tokens)} tokens, ${r.parsed.sections.length} sections, ${r.parsed.sections.reduce((n, s) => n + s.links.length, 0)} links`,
  ]
  if (r.source === 'published') {
    lines.push(
      r.full
        ? `llms-full.txt: ${r.full.url}${r.full.tokens ? ` (~${fmt(r.full.tokens)} tokens)` : ''}`
        : 'llms-full.txt: not found',
    )
    if (r.parsed.issues.length > 0) lines.push(`Spec issues: ${r.parsed.issues.slice(0, 6).join(' ')}`)
  }
  return lines
}

function body(text: string, base: string): { markdown: string; shownTokens: number } {
  const cut = truncate(text, PANE_TOKENS)
  return { markdown: absolutizeLinks(cut.text, base), shownTokens: estimateTokens(cut.text) }
}

function siteView(r: SiteResult): View {
  const isFull = /llms-full\.txt$/i.test(r.url)
  const pre = splitPreamble(r.text)
  return {
    kind: 'site',
    url: r.url,
    title: pre.title ?? r.parsed.title ?? host(r.origin),
    summary: pre.summary,
    source: r.source,
    ...body(pre.body, r.url),
    tokens: r.tokens,
    sections: isFull ? undefined : r.parsed.sections.length,
    links: isFull ? undefined : r.parsed.sections.reduce((n, s) => n + s.links.length, 0),
    // llms-full.txt is the docs themselves, not an index: the spec checks do not apply.
    issues: isFull || r.source !== 'published' ? [] : r.parsed.issues,
    siteUrl: isFull ? r.url.replace(/llms-full\.txt$/i, 'llms.txt') : r.url,
    fullUrl: isFull ? r.url : r.full?.url,
    fullTokens: isFull ? r.tokens : r.full?.tokens,
  }
}

function pageView(p: PageResult): View {
  const pre = splitPreamble(p.text)
  return {
    kind: 'page',
    url: p.url,
    title: pre.title ?? host(p.url),
    summary: pre.summary,
    source: p.via,
    ...body(pre.body, p.url),
    tokens: p.tokens,
    issues: [],
    siteUrl: `${new URL(p.url).origin}/`,
  }
}

async function navigate($: EngineInterface, input: string, push: boolean): Promise<void> {
  await update($, pending, () => input)
  await update($, status, () => 'loading' as Status)
  await update($, error, () => '')
  try {
    const target = normalizeTarget(input)
    const next =
      isSiteRoot(target) || /\/llms(-full)?\.txt$/i.test(target.pathname)
        ? siteView(await discover(net($), target.toString()))
        : pageView(await readPage(net($), target.toString()))
    await update($, doc, () => next)
    await update($, showIssues, () => false)
    if (push) {
      const at = await read($, index)
      await update($, history, list => [...list.slice(0, at + 1), next.url].slice(-50))
      await update($, index, () => Math.min(at + 1, 49))
    }
    await update($, status, () => 'idle' as Status)
  } catch (e) {
    await update($, error, () => (e instanceof Error ? e.message : String(e)))
    await update($, status, () => 'error' as Status)
  }
}

async function back($: EngineInterface): Promise<void> {
  const at = await read($, index)
  if (at <= 0) return
  const list = await read($, history)
  await update($, index, () => at - 1)
  const prev = list[at - 1]
  if (prev !== undefined) await navigate($, prev, false)
}

const BADGE: Record<View['source'], { text: string; color: string }> = {
  published: { text: '● Published llms.txt', color: 'success' },
  synthesized: { text: '◌ Synthesized — site has no llms.txt', color: 'warning' },
  markdown: { text: '● Served as markdown', color: 'success' },
  'markdown twin': { text: '● Markdown twin (.md)', color: 'success' },
  'converted from HTML': { text: '◌ Converted from HTML', color: 'warning' },
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'llms_txt',
      description:
        "Get a website's llms.txt: the curated, LLM-oriented index of its docs (https://llmstxt.org). " +
        'Use it before reading a site\'s docs to find the right pages fast. Tries <path>/llms.txt, /llms.txt and ' +
        '/.well-known/llms.txt; when the site publishes none, returns one synthesized from its homepage and sitemap ' +
        '(and says so). Reports token size, spec issues and whether llms-full.txt exists. Follow links with llms_read.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string', description: 'Domain or URL, e.g. "docs.anthropic.com" or "https://hono.dev/docs".' },
          full: { type: 'boolean', description: 'Return llms-full.txt (the whole docs in one file) instead, when the site has it. Can be very large.' },
          max_tokens: { type: 'number', description: 'Cut the returned text near this many tokens (default 15000).' },
        },
        required: ['site'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'llms_read',
      description:
        'Read one web page as clean markdown, for a link found in an llms.txt or any docs URL. Prefers the page ' +
        "itself when it is markdown, then its .md twin (the llms.txt convention), else converts the HTML. Cheaper and " +
        'cleaner than WebFetch for documentation.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The page URL.' },
          max_tokens: { type: 'number', description: 'Cut the returned text near this many tokens (default 12000).' },
        },
        required: ['url'],
      },
      isDeferred: false,
    })
    await $.command.register({
      name: 'llms-txt',
      description: "Browse a site's llms.txt in a pane",
      argumentHint: '<domain or URL>',
    })
    return next(e)
  })

  on('tool.call', { tool: 'mcp__llms-txt__llms_txt' }, async ($, e) => {
    const site = typeof e.site === 'string' ? e.site : ''
    const maxTokens = typeof e.max_tokens === 'number' ? e.max_tokens : 15_000
    const wantFull = e.full === true
    try {
      const r = await discover(net($), site, { wantFull })
      const header = siteHeader(r)
      let body = r.text
      if (wantFull) {
        if (r.full?.text) {
          header.unshift(`Returning llms-full.txt from ${r.full.url}.`)
          body = r.full.text
        } else {
          header.unshift('No llms-full.txt found; returning llms.txt instead.')
        }
      }
      const cut = truncate(body, maxTokens)
      if (cut.isTruncated) header.push(`Cut to ~${fmt(maxTokens)} tokens; raise max_tokens for more.`)
      return { result: `${header.join('\n')}\n---\n${cut.text}` }
    } catch (err) {
      return { deny: `llms_txt: ${err instanceof Error ? err.message : String(err)}` }
    }
  })

  on('tool.call', { tool: 'mcp__llms-txt__llms_read' }, async ($, e) => {
    const url = typeof e.url === 'string' ? e.url : ''
    const maxTokens = typeof e.max_tokens === 'number' ? e.max_tokens : 12_000
    try {
      const p = await readPage(net($), url)
      const cut = truncate(p.text, maxTokens)
      const header = [`Source: ${p.url} (${p.via}), ~${fmt(p.tokens)} tokens`]
      if (cut.isTruncated) header.push(`Cut to ~${fmt(maxTokens)} tokens; raise max_tokens for more.`)
      return { result: `${header.join('\n')}\n---\n${cut.text}` }
    } catch (err) {
      return { deny: `llms_read: ${err instanceof Error ? err.message : String(err)}` }
    }
  })

  on('command.run', { command: 'llms-txt' }, async ($, e) => {
    await $.ui.open({ id: PANE, title: 'llms.txt', focus: true, rows: 30, columns: 100 })
    const site = e.args.trim()
    if (site === '') return { text: 'Opened the llms.txt browser. Type a domain in its address bar.' }
    await navigate($, site, true)
    const v = await read($, doc)
    const err = await read($, error)
    return { text: err !== '' ? `llms-txt: ${err}` : `Browsing ${v?.url ?? site}.` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Link } = els
    const [v, s, err, at, wait, isIssuesOpen] = await Promise.all([
      read($, doc),
      read($, status),
      read($, error),
      read($, index),
      read($, pending),
      read($, showIssues),
    ])
    const go = (url: string) => void navigate($, url, true)
    const isLoading = s === 'loading'

    const toolbar = (
      <Box flexDirection="row" alignItems="center" columnGap={1}>
        <Button key="back" label="‹ Back" dimColor={at <= 0} onPress={() => void back($)} />
        {v && v.kind === 'page' && <Button key="home" label="Site index" onPress={() => go(v.siteUrl)} />}
        <Box flexGrow={1}>
          {'Input' in els && (
            <els.Input
              key="address"
              placeholder="Any domain or URL — e.g. hono.dev"
              value={v?.url ?? ''}
              submitLabel="go"
              autoFocus
              onSubmit={(value: string) => go(value)}
            />
          )}
        </Box>
      </Box>
    )

    if (!v) {
      return (
        <Box flexDirection="column" rowGap={1} paddingX={1}>
          {toolbar}
          <Box flexDirection="column" rowGap={0}>
            <Text bold>
              llms.txt browser
            </Text>
            <Text dimColor>
              See any site the way an LLM does: its published llms.txt, or one synthesized from its sitemap when it
              has none. Click links to read pages as clean markdown.
            </Text>
          </Box>
          {isLoading && <Text color="suggestion">Loading {host(wait)}…</Text>}
          {s === 'error' && <Text color="error">{err}</Text>}
          <Box flexDirection="row" alignItems="center" columnGap={2} flexWrap="wrap">
            <Text dimColor>Try</Text>
            {EXAMPLES.map(site => (
              <Button key={`ex-${site}`} label={site} onPress={() => go(site)} />
            ))}
          </Box>
        </Box>
      )
    }

    const badge = BADGE[v.source]
    const meta = [
      host(v.url),
      `~${fmt(v.tokens)} tokens`,
      v.sections !== undefined ? `${v.sections} sections` : undefined,
      v.links !== undefined ? `${v.links} links` : undefined,
    ].filter((x): x is string => x !== undefined)
    const isFullView = v.fullUrl !== undefined && v.url === v.fullUrl
    const isCut = v.shownTokens < v.tokens

    return (
      <Box flexDirection="column" rowGap={1} paddingX={1}>
        {toolbar}

        <Box flexDirection="column" rowGap={0} marginTop={0}>
          <Text bold wrap="truncate-end">
            {v.title}
          </Text>
          {v.summary && <Text dimColor>{v.summary}</Text>}
          <Box flexDirection="row" columnGap={2} flexWrap="wrap">
            <Text color={badge.color}>
              {badge.text}
            </Text>
            <Text dimColor>
              {meta.join('  ·  ')}
            </Text>
          </Box>
        </Box>

        <Box flexDirection="row" alignItems="center" columnGap={2} flexWrap="wrap">
          {v.kind === 'site' && isFullView && <Button key="index" label="llms.txt index" onPress={() => go(v.siteUrl)} />}
          {v.fullUrl && !isFullView && (
            <Button
              key="full"
              label={`llms-full.txt${v.fullTokens ? ` · ~${fmt(v.fullTokens)} tokens` : ''}`}
              onPress={() => go(v.fullUrl ?? v.url)}
            />
          )}
          {v.issues.length > 0 && (
            <Button
              key="issues"
              label={`⚠ ${v.issues.length} spec issue${v.issues.length === 1 ? '' : 's'}`}
              onPress={() => update($, showIssues, x => !x)}
            />
          )}
          <Link href={v.url} label="Open in browser ↗" />
        </Box>

        {isIssuesOpen && v.issues.length > 0 && (
          <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor="warning">
            {v.issues.map((issue, i) => (
              <Text key={`issue-${i}`} color="warning">
                • {issue}
              </Text>
            ))}
          </Box>
        )}

        {isLoading && <Text color="suggestion">Loading {host(wait)}…</Text>}
        {s === 'error' && <Text color="error">{err}</Text>}
        {isCut && (
          <Text color="warning">
            Large document: showing the first ~{fmt(v.shownTokens)} of ~{fmt(v.tokens)} tokens. Claude can read all of
            it with llms_txt or llms_read.
          </Text>
        )}

        {'Markdown' in els && (
          <Box marginTop={0}>
            <els.Markdown key="doc" text={v.markdown} dimColor={isLoading} onLinkPress={link => go(link.href)} />
          </Box>
        )}
      </Box>
    )
  })
}
