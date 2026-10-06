// The engine is WebGPU only: no file of the repository, and no file name, may bring back the GL
// family of APIs (its context, its shading language, its extensions, its shader built-ins). There
// is no allowlist; this file assembles its patterns from pieces so that it never matches itself.
// One process reads the files one after the other, in 64 KiB chunks: memory stays bounded whatever
// the file, binaries are skipped, and so is any file over 2 MB that is not JSON. A hit in a file
// name is reported on line 0. `pnpm run check:webgpu-only`.
import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { repositoryFiles } from './repository-files.ts'

const join = (...pieces: string[]) => pieces.join('')
const GL = join('g', 'l')

/** The patterns, longest first so a hit names the most specific one. */
const PATTERNS = [
  join('web', GL, '2RenderingContext'),
  join('getContext\\([\'"`]web', GL),
  join('EXT_', 'disjoint_timer_query'),
  join('EXT_', 'color_buffer_float'),
  join('UNPACK_', 'FLIP_Y'),
  join(GL, '_FragColor'),
  join(GL, '_Position'),
  join('#version ', '300 es'),
  join('\\bO', 'ES_\\w+'),
  join('Open', GL),
  join('web', GL),
  join(GL, 'sl'),
  join('\\b', GL, '2\\b'),
]

/** A fresh matcher of the GL family, case-insensitive. */
const glPattern = (): RegExp => new RegExp(PATTERNS.join('|'), 'gi')

/** The longest text a pattern needs to be seen whole, and the read size. */
const SPAN = 64
const CHUNK = 1 << 16
const LARGE = 2_000_000

type Hit = { file: string; line: number; match: string }

const countLines = (text: string, from: number, to: number): number => {
  let lines = 0
  for (let at = text.indexOf('\n', from); at !== -1 && at < to; at = text.indexOf('\n', at + 1))
    lines++
  return lines
}

/**
 * The hits of one file's content, read chunk by chunk. Each window is the previous window's tail
 * plus a chunk; a match is settled once `SPAN` characters follow its start, so none is reported
 * twice or cut, and the one extra character kept before the tail lets `\b` see its left side.
 */
function contentHits(path: string, file: string): Hit[] {
  const hits: Hit[] = []
  const descriptor = openSync(path, 'r')
  try {
    const decoder = new TextDecoder()
    const buffer = Buffer.alloc(CHUNK)
    let window = ''
    let from = 0
    let line = 1
    for (let first = true; ; first = false) {
      const read = readSync(descriptor, buffer, 0, CHUNK, null)
      if (first && buffer.subarray(0, read).includes(0)) return []
      window += decoder.decode(buffer.subarray(0, read), { stream: read > 0 })
      const end = read > 0 ? window.length - SPAN : window.length
      const pattern = glPattern()
      let counted = 0
      for (let found = pattern.exec(window); found; found = pattern.exec(window)) {
        if (found.index >= end) break
        if (found.index < from) continue
        line += countLines(window, counted, found.index)
        counted = found.index
        hits.push({ file, line, match: found[0] })
      }
      if (read === 0) return hits
      const cut = Math.max(0, end - 1)
      if (cut > counted) line += countLines(window, counted, cut)
      window = window.slice(cut)
      from = end - cut
    }
  } finally {
    closeSync(descriptor)
  }
}

/** Every hit of the GL family in the repository at `directory`, file names included. */
export function glHits(directory?: string): Hit[] {
  const files = repositoryFiles(directory)
  if (!files) throw new Error('Not a Git repository.')
  const root = directory ?? resolve(import.meta.dirname, '..')
  const hits: Hit[] = []
  for (const file of files) {
    for (const found of file.matchAll(glPattern())) hits.push({ file, line: 0, match: found[0] })
    const path = resolve(root, file)
    const stat = statSync(path)
    if (!stat.isFile() || (stat.size > LARGE && !file.endsWith('.json'))) continue
    hits.push(...contentHits(path, file))
  }
  return hits
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const hits = glHits(process.argv[2])
  for (const hit of hits) console.error(`${hit.file}:${hit.line}: ${hit.match}`)
  if (hits.length) process.exitCode = 1
  else console.log('WebGPU only: no trace of another graphics API.')
}
