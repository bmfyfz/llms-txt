export type View = {
  kind: 'site' | 'page'
  url: string
  title: string
  summary?: string
  // Where the text came from, shown as the view's badge.
  source: 'published' | 'synthesized' | 'markdown' | 'markdown twin' | 'converted from HTML'
  markdown: string
  tokens: number
  shownTokens: number
  sections?: number
  links?: number
  issues: string[]
  // The site's index (for a page) and its llms-full.txt, when known.
  siteUrl: string
  fullUrl?: string
  fullTokens?: number
}

export type Status = 'idle' | 'loading' | 'error'

declare module 'claude-code' {
  interface PluginState {
    'llms-txt': {
      history: string[]
      index: number
      doc: View | null
      status: Status
      error: string
      pending: string
      showIssues: boolean
    }
  }
}
