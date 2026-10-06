/**
 * The portal's Install page (`written.install` in each `site/i18n/` language) read as what a
 * newcomer does: its code blocks — the same in every language — split into the shell commands in
 * order, the page to save and the headers to serve. `prove-install-page.ts` runs them in a clean
 * folder; `install-page.test.ts` holds every language to English's blocks and links.
 */
import { loadDictionary } from '../site/content/i18n/dictionary.ts'

/** The page's entry id, `#/<locale>/learn/install` on the portal. */
const INSTALL_PAGE = 'install' as const

/** Where the page links a repository file: `blob/<branch>/<path>`. */
const REPOSITORY_FILE =
  /href="https:\/\/github\.com\/pasquelin\/Trillion3D\/blob\/[^/"]+\/([^"#]+)/g
const ENTITIES: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
}

/** The Install page's HTML in `locale`. */
export async function installPageHtml(locale: string): Promise<string> {
  const html = (await loadDictionary(locale)).written[INSTALL_PAGE]?.html
  if (!html) throw new Error(`${locale}: no Install page`)
  return html
}

/** The text of each `<pre><code>` block of `html`, its entities decoded. */
export const codeBlocks = (html: string): string[] =>
  [...html.matchAll(/<pre><code>([\s\S]*?)<\/code><\/pre>/g)].map(([, text]) =>
    text.replace(/&[a-z#0-9]+;/g, (entity) => ENTITIES[entity] ?? entity),
  )

/** The repository files `html` links to, by path from the repository's root, anchors dropped. */
export const repositoryLinks = (html: string): string[] =>
  [...html.matchAll(REPOSITORY_FILE)].map(([, path]) => path)

/** What the page asks of a newcomer. */
interface Walkthrough {
  /** The shell commands, in the page's order. */
  commands: string[]
  /** The page to save as `public/index.html`. */
  page: string
  /** The headers the server sends with the page, by name. */
  headers: Record<string, string>
}

/** The walkthrough `blocks` describe; a missing step is refused by name. */
export function walkthrough(blocks: string[]): Walkthrough {
  const commands = blocks
    .filter((block) => /^np[mx] /.test(block))
    .flatMap((block) => block.split('\n'))
  const page = blocks.find((block) => block.startsWith('<!doctype html>'))
  const headerLines = blocks.find((block) => block.startsWith('Cross-Origin-'))
  if (!commands.some((line) => line.startsWith('npm install ')))
    throw new Error('the Install page has no npm install')
  if (!commands.some((line) => line.startsWith('npx trillion3d-compile ')))
    throw new Error('the Install page compiles nothing')
  if (!page) throw new Error('the Install page has no page to draw with')
  if (!headerLines) throw new Error('the Install page names no server header')
  const headers = Object.fromEntries(headerLines.split('\n').map((line) => line.split(': ')))
  return { commands, page, headers }
}
