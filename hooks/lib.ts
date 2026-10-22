// Pure helpers: no `$`, so the tests can run them directly.

export type Link = { title: string; url: string; note?: string }
export type Section = { name: string; links: Link[] }
export type Parsed = {
  title?: string
  summary?: string
  sections: Section[]
  issues: string[]
}

export const estimateTokens = (text: string): number => Math.ceil(text.length / 4)

// "stripe.com", "https://docs.stripe.com/api" or "docs.x.com/guide" → URL.
export function normalizeTarget(input: string): URL {
  const raw = input.trim()
  if (raw === '') throw new Error('Give a domain or URL, e.g. docs.anthropic.com')
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  const url = new URL(withScheme)
  url.hash = ''
  return url
}

export const isSiteRoot = (url: URL): boolean => url.pathname === '/' || url.pathname === ''

export function looksLikeHtml(text: string, contentType = ''): boolean {
  if (/text\/html|application\/xhtml/i.test(contentType)) return true
  return /^\s*(<!doctype html|<html|<head|<body)/i.test(text)
}

const LINK_ITEM = /^\s*[-*+]\s+\[([^\]]+)\]\(\s*<?([^)\s>]+)>?\s*\)\s*(?::\s*(.*))?$/

// Parses an llms.txt per https://llmstxt.org and reports where it strays.
export function parseLlmsTxt(text: string, base?: string): Parsed {
  const lines = text.split(/\r?\n/)
  const parsed: Parsed = { sections: [], issues: [] }
  let i = 0
  while (i < lines.length && (lines[i] ?? '').trim() === '') i++

  const first = lines[i] ?? ''
  if (/^#\s+/.test(first)) {
    parsed.title = first.replace(/^#\s+/, '').trim()
    i++
  } else {
    parsed.issues.push('The file must open with an H1 title ("# Name").')
  }

  while (i < lines.length && (lines[i] ?? '').trim() === '') i++
  const quote: string[] = []
  while (i < lines.length && /^>\s?/.test(lines[i] ?? '')) {
    quote.push((lines[i] ?? '').replace(/^>\s?/, '').trim())
    i++
  }
  if (quote.length > 0) parsed.summary = quote.join(' ').trim()

  let current: Section | null = null
  let linkCount = 0
  for (; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (/^#\s+/.test(line)) {
      parsed.issues.push(`Line ${i + 1}: a second H1; only the title may be H1.`)
      continue
    }
    const h2 = line.match(/^##\s+(.*)$/)
    if (h2) {
      current = { name: (h2[1] ?? '').trim(), links: [] }
      parsed.sections.push(current)
      continue
    }
    if (!/^\s*[-*+]\s+/.test(line)) continue
    const m = line.match(LINK_ITEM)
    if (!m) {
      if (current) {
        parsed.issues.push(`Line ${i + 1}: a list item in "${current.name}" without a [title](url) link.`)
      }
      continue
    }
    if (!current) {
      parsed.issues.push(`Line ${i + 1}: a link list before any "## Section" heading.`)
      current = { name: '(no section)', links: [] }
      parsed.sections.push(current)
    }
    const raw = m[2] ?? ''
    let url = raw
    try {
      url = new URL(raw, base).toString()
    } catch {
      parsed.issues.push(`Line ${i + 1}: "${raw}" is not a valid URL.`)
    }
    current.links.push({ title: (m[1] ?? '').trim(), url, note: m[3]?.trim() || undefined })
    linkCount++
  }

  if (parsed.sections.length === 0) parsed.issues.push('No "## Section" headings with link lists.')
  else if (linkCount === 0) parsed.issues.push('Sections hold no [title](url) links.')
  for (const s of parsed.sections) {
    if (s.links.length === 0) parsed.issues.push(`Section "${s.name}" has no links.`)
  }
  return parsed
}

// Markdown links are drawn as links only when absolute.
export function absolutizeLinks(markdown: string, base: string): string {
  return markdown.replace(/(\]\(\s*<?)([^)\s>]+)/g, (whole, open: string, href: string) => {
    if (/^(https?:|mailto:|#)/i.test(href)) return whole
    try {
      return open + new URL(href, base).toString()
    } catch {
      return whole
    }
  })
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©', middot: '·',
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole
    }
    return ENTITIES[code.toLowerCase()] ?? whole
  })
}

const stripTags = (html: string): string =>
  decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()

export function htmlTitle(html: string): string | undefined {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i)
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = og?.[1] ?? t?.[1]
  return title ? stripTags(title) : undefined
}

export function htmlDescription(html: string): string | undefined {
  const m =
    html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i) ??
    html.match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)["']/i)
  const d = m?.[1] ? stripTags(m[1]) : ''
  return d === '' ? undefined : d
}

function resolveHref(href: string, base: string): string | undefined {
  const h = decodeEntities(href.trim())
  if (h === '' || /^(javascript|data|tel):/i.test(h)) return undefined
  if (h.startsWith('#') || /^mailto:/i.test(h)) return h
  try {
    return new URL(h, base).toString()
  } catch {
    return undefined
  }
}

// A small, dependency-free HTML → Markdown pass. Good enough for docs and
// articles; it keeps headings, links, lists, emphasis and code.
export function htmlToMarkdown(html: string, base: string): string {
  const title = htmlTitle(html)
  const description = htmlDescription(html)

  let body =
    html.match(/<main[\s>][\s\S]*?<\/main>/i)?.[0] ??
    html.match(/<article[\s>][\s\S]*?<\/article>/i)?.[0] ??
    html.match(/<body[\s>][\s\S]*<\/body>/i)?.[0] ??
    html
  const isFallback = !/^<(main|article)/i.test(body)

  body = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|template|iframe|form|button|select|dialog)[\s>][\s\S]*?<\/\1>/gi, '')
    .replace(/<(nav|footer)[\s>][\s\S]*?<\/\1>/gi, '')
  if (isFallback) body = body.replace(/<header[\s>][\s\S]*?<\/header>/gi, '')

  const blocks: string[] = []
  const keep = (text: string) => `\u0000${blocks.push(text) - 1}\u0000`

  body = body.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, inner: string) => {
    const lang = inner.match(/class=["'][^"']*language-([\w+-]+)/i)?.[1] ?? ''
    const code = decodeEntities(inner.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
    return keep(`\n\n\`\`\`${lang}\n${code.replace(/\n+$/, '')}\n\`\`\`\n\n`)
  })

  body = body.replace(/\s+/g, ' ')

  body = body
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, c: string) => {
      const t = stripTags(c)
      return t === '' ? '' : keep('`' + t.replace(/`/g, 'ˋ') + '`')
    })
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n: string, inner: string) => {
      const t = stripTags(inner.replace(/<a\b[^>]*>|<\/a>/gi, ''))
      return t === '' ? '' : `\n\n${'#'.repeat(Number(n))} ${t}\n\n`
    })
    .replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_, attrs: string, inner: string) => {
      const text = stripTags(inner)
      const href = attrs.match(/href\s*=\s*["']([^"']*)["']/i)?.[1]
      const url = href === undefined ? undefined : resolveHref(href, base)
      if (text === '') return ''
      if (url === undefined || url.startsWith('#')) return text
      return keep(`[${text.replace(/[[\]]/g, '')}](${url.replace(/\)/g, '%29').replace(/ /g, '%20')})`)
    })
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, t: string) => {
      const s = t.trim()
      return s === '' ? '' : ` **${s}** `
    })
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, t: string) => {
      const s = t.trim()
      return s === '' ? '' : ` *${s}* `
    })
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(ul|ol|p|div|section|table|tr|blockquote|dl|dd|dt|figure|figcaption|hr|details|summary)\b[^>]*>/gi, '\n\n')
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/<[^>]+>/g, ' ')

  let md = decodeEntities(body)
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\u0000(\d+)\u0000/g, (_, n: string) => blocks[Number(n)] ?? '')
    .replace(/\u0000(\d+)\u0000/g, (_, n: string) => blocks[Number(n)] ?? '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n- \s*\n/g, '\n')
    .trim()

  const head: string[] = []
  if (!/^# /m.test(md) && title) head.push(`# ${title}`)
  if (description && !md.includes(description)) head.push(`> ${description}`)
  if (head.length > 0) md = `${head.join('\n\n')}\n\n${md}`
  return md
}

export type PageLink = { title: string; url: string }

const ASSET = /\.(png|jpe?g|gif|webp|svg|ico|css|js|mjs|woff2?|ttf|mp4|mp3|zip|gz|xml|json)(\?|$)/i

// Same-origin page links of an HTML page, in order, deduplicated.
export function pageLinks(html: string, base: string): PageLink[] {
  const origin = new URL(base).origin
  const seen = new Set<string>()
  const out: PageLink[] = []
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = resolveHref(m[1] ?? '', base)
    if (url === undefined || url.startsWith('#') || url.startsWith('mailto:')) continue
    const u = new URL(url)
    if (u.origin !== origin || ASSET.test(u.pathname)) continue
    u.hash = ''
    const key = u.toString()
    if (seen.has(key)) continue
    const title = stripTags(m[2] ?? '') || titleFromUrl(key)
    seen.add(key)
    out.push({ title: title.slice(0, 100), url: key })
  }
  return out
}

export function sitemapLocs(xml: string): { isIndex: boolean; urls: string[] } {
  const urls = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => decodeEntities(m[1] ?? ''))
  return { isIndex: /<sitemapindex[\s>]/i.test(xml), urls }
}

export function titleFromUrl(url: string): string {
  const path = new URL(url).pathname.replace(/\/+$/, '')
  const last = path.split('/').pop() ?? ''
  if (last === '') return 'Home'
  let name = last
  try {
    name = decodeURIComponent(last)
  } catch {}
  name = name.replace(/\.(html?|md|php|aspx?)$/i, '').replace(/[-_]+/g, ' ').trim()
  return name === '' ? 'Home' : name.charAt(0).toUpperCase() + name.slice(1)
}

const sectionName = (url: string): string => {
  const seg = new URL(url).pathname.split('/').filter(Boolean)[0]
  if (seg === undefined) return 'Home'
  return titleFromUrl(`https://x/${seg}`)
}

// Builds an llms.txt for a site that publishes none, from its homepage and
// sitemap. Marked as synthesized so nobody mistakes it for the site's own.
export function synthesizeLlmsTxt(input: {
  origin: string
  homeHtml?: string
  sitemapUrls: string[]
}): string {
  const host = new URL(input.origin).host
  const html = input.homeHtml ?? ''
  const title = htmlTitle(html) ?? host
  const description = htmlDescription(html)

  const lines = [`# ${title}`, '']
  if (description) lines.push(`> ${description}`, '')
  lines.push(
    `This llms.txt was synthesized by llms-browser because ${host} publishes none. ` +
      'Sections come from the site’s sitemap and homepage links.',
    '',
  )

  const used = new Set<string>()
  const home = html === '' ? [] : pageLinks(html, input.origin)
  const homeLinks = home.filter(l => l.url !== `${input.origin}/`).slice(0, 40)
  if (homeLinks.length > 0) {
    lines.push('## Homepage links', '')
    for (const l of homeLinks) {
      used.add(l.url)
      lines.push(`- [${l.title.replace(/[[\]]/g, '')}](${l.url})`)
    }
    lines.push('')
  }

  const groups = new Map<string, string[]>()
  for (const url of input.sitemapUrls) {
    if (used.has(url)) continue
    try {
      if (new URL(url).origin !== input.origin) continue
    } catch {
      continue
    }
    const name = sectionName(url)
    const list = groups.get(name) ?? []
    list.push(url)
    groups.set(name, list)
  }
  const ranked = [...groups.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 10)
  for (const [name, urls] of ranked) {
    lines.push(`## ${name}`, '')
    for (const url of urls.slice(0, 25)) lines.push(`- [${titleFromUrl(url)}](${url})`)
    if (urls.length > 25) lines.push(`- [${urls.length - 25} more in the sitemap](${input.origin}/sitemap.xml)`)
    lines.push('')
  }

  if (homeLinks.length === 0 && ranked.length === 0) {
    lines.push('## Pages', '', `- [Home](${input.origin}/)`, '')
  }
  return lines.join('\n').trimEnd() + '\n'
}

export function truncate(text: string, maxTokens: number): { text: string; isTruncated: boolean } {
  const max = Math.max(500, maxTokens) * 4
  if (text.length <= max) return { text, isTruncated: false }
  const cut = text.lastIndexOf('\n', max)
  return { text: text.slice(0, cut > max * 0.8 ? cut : max), isTruncated: true }
}

// Candidate URLs for a page's markdown twin, per the llms.txt proposal.
export function markdownVariants(url: URL): string[] {
  if (/\.(md|txt)$/i.test(url.pathname)) return []
  const u = new URL(url.toString())
  u.search = ''
  if (u.pathname.endsWith('/')) {
    const index = new URL(u.toString())
    index.pathname += 'index.html.md'
    const trimmed = new URL(u.toString())
    trimmed.pathname = trimmed.pathname.replace(/\/+$/, '') + '.md'
    return trimmed.pathname === '.md' || trimmed.pathname === '/.md'
      ? [index.toString()]
      : [trimmed.toString(), index.toString()]
  }
  const md = new URL(u.toString())
  md.pathname += '.md'
  return [md.toString()]
}

// Splits a document's opening "# Title" and "> summary" from its body, so a
// view can show them as its header instead of repeating them.
export function splitPreamble(text: string): { title?: string; summary?: string; body: string } {
  const lines = text.split(/\r?\n/)
  let i = 0
  while (i < lines.length && (lines[i] ?? '').trim() === '') i++
  const h1 = (lines[i] ?? '').match(/^#\s+(.*)$/)
  if (!h1) return { body: text }
  const title = (h1[1] ?? '').trim()
  i++
  while (i < lines.length && (lines[i] ?? '').trim() === '') i++
  const quote: string[] = []
  while (i < lines.length && /^>\s?/.test(lines[i] ?? '')) {
    quote.push((lines[i] ?? '').replace(/^>\s?/, '').trim())
    i++
  }
  const summary = quote.join(' ').trim()
  return { title, summary: summary === '' ? undefined : summary, body: lines.slice(i).join('\n').trim() }
}
