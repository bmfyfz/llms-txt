import { expect, test } from 'claude-code/testing'

import {
  absolutizeLinks,
  htmlToMarkdown,
  isPrivateHost,
  markdownVariants,
  normalizeTarget,
  parseLlmsTxt,
  synthesizeLlmsTxt,
} from '../hooks/lib'

const GOOD = `# Hono

> Web framework built on Web Standards.

Some notes.

## Docs

- [Getting started](/docs/getting-started.md): First steps
- [Routing](https://hono.dev/docs/api/routing.md)

## Optional

- [Blog](https://hono.dev/blog)
`

test('parses a spec-following llms.txt', () => {
  const p = parseLlmsTxt(GOOD, 'https://hono.dev/llms.txt')
  expect(p.title).toBe('Hono')
  expect(p.summary).toBe('Web framework built on Web Standards.')
  expect(p.sections.map(s => s.name)).toEqual(['Docs', 'Optional'])
  expect(p.sections[0]?.links[0]).toEqual({
    title: 'Getting started',
    url: 'https://hono.dev/docs/getting-started.md',
    note: 'First steps',
  })
  expect(p.issues).toEqual([])
})

test('reports spec issues', () => {
  const p = parseLlmsTxt('Welcome\n\n- [a](/a)\n## Empty\n', 'https://x.dev/llms.txt')
  expect(p.issues.some(i => i.includes('H1'))).toBe(true)
  expect(p.issues.some(i => i.includes('before any'))).toBe(true)
  expect(p.issues.some(i => i.includes('"Empty" has no links'))).toBe(true)
})

test('normalizes bare domains and makes links absolute', () => {
  expect(normalizeTarget('docs.anthropic.com').toString()).toBe('https://docs.anthropic.com/')
  expect(absolutizeLinks('[a](/x) [b](https://y.dev) [c](#top)', 'https://s.dev/docs/llms.txt')).toBe(
    '[a](https://s.dev/x) [b](https://y.dev) [c](#top)',
  )
})

test('lists markdown twins', () => {
  expect(markdownVariants(new URL('https://s.dev/docs/intro'))).toEqual(['https://s.dev/docs/intro.md'])
  expect(markdownVariants(new URL('https://s.dev/docs/'))).toEqual([
    'https://s.dev/docs.md',
    'https://s.dev/docs/index.html.md',
  ])
  expect(markdownVariants(new URL('https://s.dev/llms.txt'))).toEqual([])
})

test('converts HTML to markdown', () => {
  const html = `<html><head><title>Guide</title><meta name="description" content="A guide."></head>
  <body><nav><a href="/x">Nav</a></nav><main><h1>Install</h1><p>Run <code>npm i</code> then
  read <a href="/docs/next">the <b>next</b> page</a>.</p><ul><li>One</li><li>Two &amp; three</li></ul>
  <pre><code class="language-sh">npm run   dev
echo ok</code></pre><script>alert(1)</script></main></body></html>`
  const md = htmlToMarkdown(html, 'https://s.dev/docs/install')
  expect(md).toContain('# Install')
  expect(md).toContain('`npm i`')
  expect(md).toContain('(https://s.dev/docs/next)')
  expect(md).toContain('- Two & three')
  expect(md).toContain('```sh\nnpm run   dev\necho ok\n```')
  expect(md.includes('Nav')).toBe(false)
  expect(md.includes('alert')).toBe(false)
})

test('synthesizes an llms.txt from homepage and sitemap', () => {
  const text = synthesizeLlmsTxt({
    origin: 'https://s.dev',
    homeHtml: '<title>S</title><a href="/pricing">Pricing</a><a href="https://other.com/">x</a>',
    sitemapUrls: ['https://s.dev/blog/one-post', 'https://s.dev/blog/two', 'https://s.dev/pricing'],
  })
  const p = parseLlmsTxt(text, 'https://s.dev/')
  expect(p.title).toBe('S')
  expect(p.issues).toEqual([])
  expect(p.sections.map(s => s.name)).toEqual(['Homepage links', 'Blog'])
  expect(p.sections[1]?.links.map(l => l.title)).toEqual(['One post', 'Two'])
})

test('groups prose list items into one issue per section', () => {
  const text = '# Svelte\n\n## Docs\n\n- [A](/a)\n\n## Notes\n\n- one\n- two\n- three\n'
  const p = parseLlmsTxt(text, 'https://svelte.dev/llms.txt')
  expect(p.issues.length).toBe(1)
  expect(p.issues[0]).toContain('Section "Notes" has 3 list items without a [title](url) link')
})

test('tells private hosts from public ones', () => {
  for (const h of ['localhost', 'app.localhost', 'nas.local', 'db.internal', '127.0.0.1', '10.1.2.3', '172.20.0.1',
    '192.168.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '[::1]', '::ffff:7f00:1', 'fd00::1', 'fe80::1', 'router']) {
    expect(isPrivateHost(h), h).toBe(true)
  }
  for (const h of ['hono.dev', 'docs.anthropic.com', '8.8.8.8', '172.32.0.1', '[2606:4700::1111]']) {
    expect(isPrivateHost(h), h).toBe(false)
  }
})
