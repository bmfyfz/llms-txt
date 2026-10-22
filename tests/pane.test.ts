import type { HttpResponse } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const res = (status: number, text: string, type = 'text/plain'): HttpResponse => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { 'content-type': type },
  text,
})

const SITE: Record<string, HttpResponse> = {
  'https://docs.pub.dev/llms.txt': res(200, '# Pub\n\n> Docs for Pub.\n\n## Docs\n\n- [Intro](/intro.md)\n- broken item\n'),
  'https://docs.pub.dev/llms-full.txt': res(200, ''),
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`pane draws the empty state and a site on ${surface}`, async ($, on) => {
    on('clock.now', () => ({ value: 0 }))
    on('http.fetch', (_$, e) => ({ value: SITE[e.url] ?? res(404, 'not found') }))
    on('ui.open', () => ({ value: { isPlaced: true, id: 'llms' } as never }))

    // The pane reads none of its props; the kit fills in what a surface would.
    const props = { title: 'llms.txt', isFocused: true, bodyColumns: 100 } as never
    const pane = await $.ui.mount({ plugin: 'llms-txt', surface, component: 'Pane', requestId: 'llms', props })
    expect(await pane.find({ text: 'llms.txt browser' })).toBeDefined()
    expect(await pane.find({ key: 'ex-hono.dev' })).toBeDefined()

    await $.ui.input({ plugin: 'llms-txt', key: 'address', text: 'docs.pub.dev', requestId: 'llms', surface })
    expect(await pane.find({ text: 'Pub' })).toBeDefined()
    expect(await pane.find({ text: 'Docs for Pub.' })).toBeDefined()
    expect(await pane.find({ text: /Published llms\.txt/ })).toBeDefined()
    expect(await pane.find({ key: 'full' })).toBeDefined()
    expect(await pane.find({ key: 'issues' })).toBeDefined()
  })
}
