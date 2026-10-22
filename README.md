# llms-txt

A Claude Code plugin for reading the web the way an LLM should: through [llms.txt](https://llmstxt.org).

- **`llms_txt` tool**: Claude gets a site's llms.txt (checking `<path>/llms.txt`, `/llms.txt`, `/.well-known/llms.txt`), with its token size, spec issues and whether `llms-full.txt` exists. Sites with no llms.txt get one synthesized from their homepage and sitemap, clearly labelled as such.
- **`llms_read` tool**: reads any page as clean markdown, preferring markdown the server sends, then the page's `.md` twin, then converting the HTML.
- **`/llms-txt <domain>`**: opens a browser pane in Claude Code. Type a domain, click links to follow them, toggle spec issues, jump to `llms-full.txt`.

## Install

From a shell:

```bash
claude plugin marketplace add bmfyfz/llms-txt
claude plugin install llms-txt@llms-txt
```

Or at the prompt of a Claude Code session:

```
/plugin marketplace add bmfyfz/llms-txt
/plugin install llms-txt@llms-txt
```

Newer Claude Code versions also take one line: `claude plugin install llms-txt --marketplace bmfyfz/llms-txt`.

In the Claude desktop app, where `/plugin` doesn't run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `bmfyfz/llms-txt`, then **Add plugin**.

The plugin uses Claude Code's early-access hooks API. If `/llms-txt` doesn't show up, update Claude Code (`claude update`).

## Use

- `/llms-txt hono.dev` opens the browser pane.
- Or just ask: *"Use llms_txt on docs.stripe.com and find how webhook signatures are verified."*

## Develop

The plugin is a Claude Code hooks module (early access): `hooks/register.tsx` registers the tools, command and pane; `hooks/web.ts` fetches and discovers; `hooks/lib.ts` holds the parser, spec checks, HTML→markdown and llms.txt synthesis.

```bash
claude --plugin-dir .
```

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test .
```

```bash
claude plugin validate .
```
