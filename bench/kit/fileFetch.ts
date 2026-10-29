// `fetch` for the engine's own files in Node: its WebAssembly and workers sit beside its modules as
// `file:` addresses, which Node's `fetch` refuses, and a page asks relative ones, which it cannot
// read. Every other address goes to the real `fetch`.
import { open, readFile } from 'node:fs/promises'

const TYPES: Record<string, string> = {
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.js': 'text/javascript',
  '.ts': 'text/javascript',
}

const typeOf = (href: string) =>
  TYPES[href.slice(href.lastIndexOf('.')).replace(/[?#].*$/, '')] ?? 'application/octet-stream'

/** The bytes `bytes=first-last` of the file at `href`, as a server answers a range: 206 with the part and its `content-range`; the whole file when the range names none. */
export async function fileResponse(href: string, range: string | null) {
  const found = range && /^bytes=(\d+)-(\d*)$/.exec(range)
  if (!found) {
    const body = await readFile(new URL(href))
    return new Response(body, { status: 200, headers: { 'content-type': typeOf(href) } })
  }
  const handle = await open(new URL(href))
  try {
    const { size } = await handle.stat()
    const first = Number(found[1]),
      last = Math.min(found[2] === '' ? size - 1 : Number(found[2]), size - 1)
    if (first >= size) return new Response(null, { status: 416 })
    const part = Buffer.alloc(last - first + 1)
    await handle.read(part, 0, part.length, first)
    return new Response(part, {
      status: 206,
      headers: {
        'content-type': typeOf(href),
        'content-range': `bytes ${first}-${last}/${size}`,
      },
    })
  } finally {
    await handle.close()
  }
}

/** Installs the `file:`-aware `fetch` once on this thread's global. */
export function installFileFetch() {
  const real = globalThis.fetch
  if ((real as { fileAware?: boolean }).fileAware) return
  const fileFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const asked = typeof input === 'string' ? input : 'url' in input ? input.url : input.href
    // A relative address is the page's, as a browser reads it.
    const href = new URL(asked, globalThis.location?.href).href
    if (!href.startsWith('file:')) return real(typeof input === 'string' ? href : input, init)
    try {
      return await fileResponse(href, new Headers(init?.headers).get('range'))
    } catch {
      return new Response(null, { status: 404, statusText: `not found: ${href}` })
    }
  }
  globalThis.fetch = Object.assign(fileFetch, { fileAware: true }) as typeof fetch
}
