import type { PageRec } from '../../page/selection/selection.ts'

/**
 * The WebGL2 pages as the shared residency reads them: a small integer per URL, memoised on each
 * record (`PageRec.keyIndex`, checked against the URL it names) so an image hashes no string, and
 * given back once the page is no longer held, so the tables follow what the view holds, never
 * every URL ever asked for.
 */
export function createPageKeys() {
  const keys = new Map<string, number>(),
    urls: (string | undefined)[] = [],
    free: number[] = []
  return {
    keyOf(rec: PageRec) {
      const memo = rec.keyIndex
      if (memo !== undefined && urls[memo] === rec.url) return memo
      let key = keys.get(rec.url)
      if (key === undefined) {
        key = free.pop() ?? urls.length
        keys.set(rec.url, key)
        urls[key] = rec.url
      }
      return (rec.keyIndex = key)
    },
    find: (url: string) => keys.get(url),
    urlOf: (key: number) => urls[key]!,
    /** The page is no longer held: its key is reused. */
    free(key: number) {
      keys.delete(urls[key]!)
      urls[key] = undefined
      free.push(key)
    },
    /** Keys in use: the pages held. */
    get size() {
      return keys.size
    },
  }
}
