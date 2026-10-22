import type { HttpInit, HttpResponse } from 'claude-code'

import {
  estimateTokens,
  isSiteRoot,
  looksLikeHtml,
  markdownVariants,
  normalizeTarget,
  parseLlmsTxt,
  sitemapLocs,
  synthesizeLlmsTxt,
  htmlToMarkdown,
  type Parsed,
} from './lib'

type Got = { url: string; ok: boolean; status: number; text: string; type: string; length?: number }

// What the module needs from the host; register.tsx builds it from `$`.
export type Net = {
  fetch: (url: string, init?: HttpInit) => Promise<HttpResponse>
  now: () => Promise<number>
}

const TTL_MS = 10 * 60 * 1000
const cache = new Map<string, { at: number; got: Got }>()

async function get(
  net: Net,
  url: string,
  init: { method?: string; accept?: string } = {},
): Promise<Got> {
  const method = init.method ?? 'GET'
  const key = `${method} ${init.accept ?? ''} ${url}`
  const now = await net.now()
  const hit = cache.get(key)
  if (hit && now - hit.at < TTL_MS) return hit.got

  let got: Got
  try {
    const res = await net.fetch(url, {
      method,
      headers: { Accept: init.accept ?? 'text/plain, text/markdown, text/html;q=0.8, */*;q=0.5' },
    })
    const length = Number(res.headers['content-length'])
    got = {
      url,
      ok: res.ok,
      status: res.status,
      text: res.text,
      type: res.headers['content-type'] ?? '',
      length: Number.isFinite(length) ? length : undefined,
    }
  } catch (error) {
    got = { url, ok: false, status: 0, text: String(error), type: '' }
  }
  cache.set(key, { at: now, got })
  return got
}

const isText = (g: Got): boolean => g.ok && g.text.trim() !== '' && !looksLikeHtml(g.text, g.type)

export type SiteResult = {
  origin: string
  source: 'published' | 'synthesized'
  url: string
  text: string
  parsed: Parsed
  tokens: number
  full?: { url: string; tokens?: number; text?: string }
  note?: string
}

function llmsCandidates(target: URL): string[] {
  const dirs = new Set<string>()
  const path = target.pathname.replace(/\/[^/]*\.[a-z0-9]+$/i, '/').replace(/\/+$/, '')
  if (path !== '') dirs.add(path)
  dirs.add('')
  const out = [...dirs].map(d => `${target.origin}${d}/llms.txt`)
  out.push(`${target.origin}/.well-known/llms.txt`)
  return out
}

// Finds a site's llms.txt (subpath, root, then .well-known); with none,
// builds one from the homepage and sitemap.
export async function discover(
  net: Net,
  site: string,
  opts: { wantFull?: boolean } = {},
): Promise<SiteResult> {
  const target = normalizeTarget(site)
  const origin = target.origin

  if (/\/llms(-full)?\.txt$/i.test(target.pathname)) {
    const g = await get(net, target.toString())
    if (!isText(g)) throw new Error(`${target} answered ${g.status || 'no response'}.`)
    return finish(net, origin, target.toString(), 'published', g.text, opts)
  }

  for (const url of llmsCandidates(target)) {
    const g = await get(net, url)
    if (isText(g)) return finish(net, origin, url, 'published', g.text, opts)
  }

  const home = isSiteRoot(target) ? `${origin}/` : target.toString()
  const [page, robots] = await Promise.all([get(net, home, { accept: 'text/html' }), get(net, `${origin}/robots.txt`)])
  const fromRobots = isText(robots)
    ? [...robots.text.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map(m => m[1] ?? '')
    : []
  const sitemapUrls = await collectSitemap(net, fromRobots.length > 0 ? fromRobots : [`${origin}/sitemap.xml`])
  if (!page.ok && sitemapUrls.length === 0) {
    throw new Error(`${origin} has no llms.txt, and neither its homepage nor a sitemap could be read (HTTP ${page.status || 'error'}).`)
  }
  const text = synthesizeLlmsTxt({ origin, homeHtml: page.ok ? page.text : undefined, sitemapUrls })
  const result = await finish(net, origin, origin, 'synthesized', text, {})
  result.note = `No llms.txt at ${llmsCandidates(target).join(', ')}; synthesized from ${
    page.ok ? 'the homepage' : ''
  }${page.ok && sitemapUrls.length > 0 ? ' and ' : ''}${sitemapUrls.length > 0 ? `${sitemapUrls.length} sitemap URLs` : ''}.`
  return result
}

async function collectSitemap(net: Net, start: string[]): Promise<string[]> {
  const urls: string[] = []
  const queue = start.slice(0, 3)
  let fetched = 0
  while (queue.length > 0 && fetched < 6 && urls.length < 2000) {
    const g = await get(net, queue.shift() as string, { accept: 'application/xml, text/xml' })
    fetched++
    if (!g.ok) continue
    const { isIndex, urls: locs } = sitemapLocs(g.text)
    if (isIndex) queue.push(...locs.slice(0, 5 - fetched))
    else urls.push(...locs)
  }
  return [...new Set(urls)]
}

async function finish(
  net: Net,
  origin: string,
  url: string,
  source: SiteResult['source'],
  text: string,
  opts: { wantFull?: boolean },
): Promise<SiteResult> {
  const result: SiteResult = {
    origin,
    source,
    url,
    text,
    parsed: parseLlmsTxt(text, url),
    tokens: estimateTokens(text),
  }
  if (source === 'published' && !/llms-full\.txt$/i.test(url)) {
    const fullUrl = url.replace(/llms\.txt$/i, 'llms-full.txt')
    const g = opts.wantFull ? await get(net, fullUrl) : await get(net, fullUrl, { method: 'HEAD' })
    const exists = opts.wantFull ? isText(g) : g.ok && !/text\/html/i.test(g.type)
    if (exists) {
      result.full = {
        url: fullUrl,
        tokens: opts.wantFull ? estimateTokens(g.text) : g.length === undefined ? undefined : Math.ceil(g.length / 4),
        text: opts.wantFull ? g.text : undefined,
      }
    }
  }
  return result
}

export type PageResult = {
  url: string
  via: 'markdown' | 'markdown twin' | 'converted from HTML'
  text: string
  tokens: number
}

// Reads one page as markdown: the page itself if it is markdown, its `.md`
// twin when the site serves one, else the HTML converted.
export async function readPage(net: Net, input: string): Promise<PageResult> {
  const target = normalizeTarget(input)
  const url = target.toString()

  for (const twin of markdownVariants(target)) {
    const g = await get(net, twin)
    if (isText(g)) return { url: twin, via: 'markdown twin', text: g.text, tokens: estimateTokens(g.text) }
  }

  const g = await get(net, url, { accept: 'text/markdown, text/plain;q=0.9, text/html;q=0.8' })
  if (!g.ok) throw new Error(`${url} answered ${g.status || `no response (${g.text})`}.`)
  if (!looksLikeHtml(g.text, g.type)) {
    return { url, via: 'markdown', text: g.text, tokens: estimateTokens(g.text) }
  }
  const md = htmlToMarkdown(g.text, url)
  return { url, via: 'converted from HTML', text: md, tokens: estimateTokens(md) }
}
