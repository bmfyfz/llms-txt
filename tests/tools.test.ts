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
}

const net = (on: On) => {
  on('clock.now', () => ({ value: 0 }))
  on('http.fetch', (_$, e) => ({ value: SITE[e.url] ?? res(404, 'not found') }))
}

test('llms_txt returns a published llms.txt with its facts', async ($, on) => {
  net(on)
  const r = await $.tool.call({ tool: 'mcp__llms-txt__llms_txt', site: 'docs.pub.dev' })
  const text = String(r.result ?? JSON.stringify(r))
  expect(text).toContain('Source: https://docs.pub.dev/llms.txt (published by the site)')
  expect(text).toContain('llms-full.txt: https://docs.pub.dev/llms-full.txt')
  expect(text).toContain('- [Intro](/intro.md)')
})

test('llms_txt synthesizes one when the site serves HTML for every path', async ($, on) => {
  net(on)
  const r = await $.tool.call({ tool: 'mcp__llms-txt__llms_txt', site: 'https://spa.dev' })
  const text = String(r.result ?? JSON.stringify(r))
  expect(text).toContain('Source: synthesized')
  expect(text).toContain('[About us](https://spa.dev/about)')
  expect(text).toContain('## Guides')
})

test('llms_read prefers the markdown twin', async ($, on) => {
  net(on)
  const r = await $.tool.call({ tool: 'mcp__llms-txt__llms_read', url: 'https://docs.pub.dev/intro' })
  const text = String(r.result ?? JSON.stringify(r))
  expect(text).toContain('(markdown twin)')
  expect(text).toContain('Hello.')
})
