# llms-txt

A Claude Code plugin for reading the web the way an LLM should: through [llms.txt](https://llmstxt.org).

- **`index` tool** (`mcp__llms-txt__index`): Claude gets a site's llms.txt (checking `<path>/llms.txt`, `/llms.txt`, `/.well-known/llms.txt`), with its token size, spec issues and whether `llms-full.txt` exists. Sites with no llms.txt get one synthesized from their homepage and sitemap, clearly labelled as such.
- **`read` tool** (`mcp__llms-txt__read`): reads any page as clean markdown, preferring markdown the server sends, then the page's `.md` twin, then converting the HTML.
- **`/llms-txt <domain>`**: opens a browser pane in Claude Code. Type a domain, click links to follow them, toggle spec issues, jump to `llms-full.txt`.

## Install

From a shell:

```bash
claude plugin marketplace add bmfyfz/llms-txt
claude plugin install llms-txt@bmfyfz
```

Or at the prompt of a Claude Code session:

```
/plugin marketplace add bmfyfz/llms-txt
/plugin install llms-txt@bmfyfz
```

Newer Claude Code versions also take one line: `claude plugin install llms-txt --marketplace bmfyfz/llms-txt`.

In the Claude desktop app, where `/plugin` doesn't run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `bmfyfz/llms-txt`, then **Add plugin**.

The plugin uses Claude Code's early-access hooks API. If `/llms-txt` doesn't show up, update Claude Code (`claude update`).

## Use

- `/llms-txt hono.dev` opens the browser pane.
- Or just ask: *"Look up docs.stripe.com through its llms.txt and find how webhook signatures are verified."*

The tools load on demand, so they add nothing to Claude's context until a task needs them.

## Safety

- **Public sites only for the tools.** `index` and `read` refuse `localhost`, private and link-local IPs (including cloud metadata at `169.254.169.254`), `.local`/`.internal` names and non-http URLs, so a link planted in a page can't make Claude probe your network. The `/llms-txt` pane, where you type or click every address yourself, can open local sites, handy for previewing your own `llms.txt` on `localhost`. The check is on the URL as written: a public host that redirects or resolves to a private address isn't caught.
- **Web content is labelled.** Every tool result says its text is untrusted content from the named site, so instructions inside a page read as data.

## Develop

`hooks/register.tsx` registers the tools, command and pane; `hooks/web.ts` fetches and discovers; `hooks/lib.ts` holds the parser, spec checks, HTML→markdown, private-host check and llms.txt synthesis.

```bash
claude --plugin-dir .
```

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test .
```

```bash
claude plugin validate . --strict
```

Bump `version` in `.claude-plugin/plugin.json` with every release; `claude plugin update` installs only a new version.

## License

MIT
