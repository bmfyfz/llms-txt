import type { HttpResponse, On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const res = (status: number, text: string, type = 'text/plain'): HttpResponse => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { 'content-type': type },
  text,
})

const SITE: Record<string, HttpResponse> = {
  'https://docs.pub.dev/llms.txt': res(200, '# Pub\n\n> Docs.\n\n## Docs\n\n- [Intro](/intro.md)\n'),
  'https://docs.pub.dev/llms-full.txt': res(200, '', 'text/plain'),
  'https://docs.pub.dev/intro.md': res(200, '# Intro\n\nHello.'),
  // A SPA that answers every path with its HTML shell: not an llms.txt.
  'https://spa.dev/': res(200, '<!doctype html><title>Spa</title><a href="/about">About us</a>', 'text/html'),
  'https://spa.dev/llms.txt': res(200, '<!doctype html><title>Spa</title>', 'text/html'),
  'https://spa.dev/.well-known/llms.txt': res(200, '<!doctype html><title>Spa</title>', 'text/html'),
  'https://spa.dev/robots.txt': res(200, 'User-agent: *\nSitemap: https://spa.dev/sm.xml\n'),
  'https://spa.dev/sm.xml': res(200, '<urlset><url><loc>https://spa.dev/guides/setup</loc></url></urlset>', 'application/xml'),
  // A server that refuses HEAD but serves llms-full.txt on GET.
  'https://nohead.dev/llms.txt': res(200, '# NoHead\n\n## Docs\n\n- [A](/a.md)\n'),
}

const fetched: string[] = []

const net = (on: On) => {
  fetched.length = 0
  on('clock.now', () => ({ value: 0 }))
  on('http.fetch', (_$, e) => {
    fetched.push(`${e.init?.method ?? 'GET'} ${e.url}`)
    if (e.url === 'https://nohead.dev/llms-full.txt') {
      return { value: e.init?.method === 'HEAD' ? res(405, '') : res(200, 'x'.repeat(4000)) }
    }
    return { value: SITE[e.url] ?? res(404, 'not found') }
  })
}

test('index returns a published llms.txt with its facts', async ($, on) => {
  net(on)
  const r = await $.tool.call({ tool: 'mcp__llms-txt__index', site: 'docs.pub.dev' })
  const text = String(r.result)
  expect(text).toContain('Source: https://docs.pub.dev/llms.txt (published by the site)')
  expect(text).toContain('llms-full.txt: https://docs.pub.dev/llms-full.txt')
  expect(text).toContain('Untrusted: everything below the --- line is content from docs.pub.dev.')
  expect(text).toContain('- [Intro](/intro.md)')
})

test('index synthesizes one when the site serves HTML for every path', async ($, on) => {
  net(on)
  const r = await $.tool.call({ tool: 'mcp__llms-txt__index', site: 'https://spa.dev' })
  const text = String(r.result)
  expect(text).toContain('Source: synthesized')
  expect(text).toContain('[About us](https://spa.dev/about)')
  expect(text).toContain('## Guides')
})

test('index falls back to GET when the server refuses HEAD', async ($, on) => {
  net(on)
  const r = await $.tool.call({ tool: 'mcp__llms-txt__index', site: 'nohead.dev' })
  expect(String(r.result)).toContain('llms-full.txt: https://nohead.dev/llms-full.txt (~1.0k tokens)')
  expect(fetched).toContain('HEAD https://nohead.dev/llms-full.txt')
  expect(fetched).toContain('GET https://nohead.dev/llms-full.txt')
})

test('read prefers the markdown twin', async ($, on) => {
  net(on)
  const r = await $.tool.call({ tool: 'mcp__llms-txt__read', url: 'https://docs.pub.dev/intro' })
  const text = String(r.result)
  expect(text).toContain('(markdown twin)')
  expect(text).toContain('Hello.')
  expect(text).toContain('Untrusted:')
})

for (const url of [
  'http://localhost:3000/docs',
  'http://127.0.0.1/',
  'http://2130706433/',
  'http://169.254.169.254/latest/meta-data/',
  'http://10.0.0.5/admin',
  'http://[::1]/',
  'http://router/',
  'file:///etc/passwd',
]) {
  test(`read refuses ${url} without fetching`, async ($, on) => {
    net(on)
    const r = await $.tool.call({ tool: 'mcp__llms-txt__read', url })
    expect(r.result).toBeUndefined()
    expect(fetched).toEqual([])
  })
}

test('index refuses a private host without fetching', async ($, on) => {
  net(on)
  const r = await $.tool.call({ tool: 'mcp__llms-txt__index', site: 'http://192.168.1.1' })
  expect(r.result).toBeUndefined()
  expect(fetched).toEqual([])
})
