/** The manifest as a page tree (`compiler_manifest_pages.rs`, FORMAT.md): the fixed-size root
 *  `clusters.json`, its head page (every other field, the previews' sidecar) and its mesh pages
 *  (slim primitives, their sidecar), read through the scene partition's pager
 *  (`tablePartition.ts`): whole (`readPagedManifest`), or its head and the mesh pages a view
 *  holds (`openPagedManifest`). */
import { EngineError, type ClusterManifest, type Primitive } from '../contracts/index.ts'
import { named, readLeaves, type PageKind, type TablePage } from '../scene/core/tablePages.ts'
import { decodeManifestBinary } from './binaryDecode.ts'
import { MANIFEST_BINARY_VERSION } from './binaryFormat.ts'
import { assertManifestBinary, type SlimClusterManifest } from './binaryTypes.ts'

/** The manifest's pages: a mesh page lists its slim primitives. */
const MANIFEST_PAGES: PageKind = {
  prefix: 'manifest-page-',
  version: MANIFEST_BINARY_VERSION,
  records: 'primitives',
  unsupported: 'UNSUPPORTED_FORMAT',
  invalid: 'INVALID_CACHE',
}

/** How a hold asks its pages read: the signal that lets it go, and its priority. */
export type PageAsk = { signal?: AbortSignal; priority?: number }
type Read = (page: TablePage, asked?: PageAsk) => Promise<Uint8Array>
type Body = Awaited<ReturnType<typeof readLeaves>>[number]

/** The bytes of `view` as a buffer of their own. */
const buffer = (view: Uint8Array): ArrayBuffer =>
  view.byteOffset === 0 && view.byteLength === view.buffer.byteLength
    ? (view.buffer as ArrayBuffer)
    : (view.slice().buffer as ArrayBuffer)

/** The root's fields and slots, or a named refusal of a root without a head page or pages. */
function split(root: Record<string, unknown>) {
  const { head, pages, ...fixed } = root
  if (!Array.isArray(pages) || !named(MANIFEST_PAGES, [head]).length)
    throw new EngineError('INVALID_CACHE', 'the manifest root names no head page or no pages', {})
  return { head: named(MANIFEST_PAGES, [head]), pages: named(MANIFEST_PAGES, pages), fixed }
}

/** A page's body beside its sidecar, read through `read`, which proves it by its slot. */
async function withSidecar(body: Body, read: Read) {
  assertManifestBinary(body.binary)
  return { body, bytes: buffer(await read(body.binary)) }
}

/** The manifest the head page `first` names — its primitives none — and the decoder of a mesh
 *  page under it: each field the root's, then the head's, a page's own primitives and sidecar. */
function headed(fixed: Record<string, unknown>, first: Awaited<ReturnType<typeof withSidecar>>) {
  const { version: _version, binary: _binary, primitives: _none, ...top } = first.body
  const decode = ({ body: { primitives, binary }, bytes }: typeof first) =>
    decodeManifestBinary({ ...fixed, ...top, primitives, binary } as SlimClusterManifest, bytes)
  return { metadata: { ...decode(first), primitives: [] as Primitive[] }, decode }
}

/**
 * The manifest under `root`, its pages and their sidecars read side by side through `read` — in a
 * browser `fetchVerified`, which proves each by the size and fingerprint that name it: the root's
 * fields, the head's, and the primitives of every mesh page in order (`decodeManifestBinary`).
 */
export async function readPagedManifest(
  root: Record<string, unknown>,
  read: (page: TablePage) => Promise<Uint8Array>,
): Promise<ClusterManifest> {
  const { head, pages, fixed } = split(root)
  // The head first, then the mesh pages in order, all read side by side.
  const bodies = await readLeaves(MANIFEST_PAGES, [...head, ...pages], read)
  const [first, ...meshes] = await Promise.all(bodies.map((body) => withSidecar(body, read)))
  const { metadata, decode } = headed(fixed, first)
  return { ...metadata, primitives: meshes.flatMap((mesh) => decode(mesh).primitives) }
}

/** The mesh pages of a manifest opened by its head (`openPagedManifest`), held by a count. */
export interface ManifestPages {
  /** The manifest's primitives now, in rank order: those of every page held and read, the very
   *  list its `metadata.primitives` is. */
  readonly primitives: readonly Primitive[]
  /** Bumped each time a page's primitives join or leave `primitives`. */
  readonly changes: number
  /** Counts one more holder of each page `slots` name; a page not yet read is, as `asked`, its
   *  primitives appended once it lands. Settles once every one is; if one fails, none is counted. */
  hold(slots: readonly string[], asked?: PageAsk): Promise<void>
  /** Counts one holder less of each; a page none holds any longer leaves with its primitives. */
  release(slots: readonly string[]): void
}

/**
 * The manifest under `root` with its head read and no mesh page: its primitives are those
 * of the pages `pages` holds, read through `read` on their first hold and passed through `accept`
 * — which checks and places them — before they join `metadata.primitives`.
 */
export async function openPagedManifest(
  root: Record<string, unknown>,
  read: Read,
  accept: (primitives: Primitive[]) => Primitive[] = (primitives) => primitives,
): Promise<{ metadata: ClusterManifest; pages: ManifestPages }> {
  const { head, fixed } = split(root)
  const [body] = await readLeaves(MANIFEST_PAGES, head, read)
  const { metadata, decode } = headed(fixed, await withSidecar(body, read))
  const list = metadata.primitives
  type Held = { count: number; primitives?: Primitive[] }
  const held = new Map<string, Held>()
  let changes = 0
  /** `slot` read for one hold as `asked`, placed by the first to land unless released before. */
  const load = async (slot: string, entry: Held, asked?: PageAsk) => {
    const own = (page: TablePage) => read(page, asked)
    const [page] = await readLeaves(MANIFEST_PAGES, named(MANIFEST_PAGES, [slot]), own)
    const body = await withSidecar(page, own)
    if (held.get(slot) !== entry || entry.primitives) return
    entry.primitives = accept(decode(body).primitives)
    for (const primitive of entry.primitives) list.push(primitive)
    // In rank order, whichever page landed first: the list is the same for the same pages held.
    list.sort((a, b) => a.mesh - b.mesh || a.primitive - b.primitive)
    changes++
  }
  const pages: ManifestPages = {
    primitives: list,
    get changes() {
      return changes
    },
    async hold(slots, asked) {
      const settled = await Promise.allSettled(
        slots.map((slot) => {
          let entry = held.get(slot)
          if (!entry) held.set(slot, (entry = { count: 0 }))
          entry.count++
          return entry.primitives ? undefined : load(slot, entry, asked)
        }),
      )
      const failed = settled.find((result) => result.status === 'rejected')
      if (!failed) return
      // All or nothing: a hold that failed counts no holder, and the next one reads again.
      pages.release(slots)
      throw failed.reason
    },
    release(slots) {
      for (const slot of slots) {
        const entry = held.get(slot)
        if (!entry || --entry.count > 0) continue
        held.delete(slot)
        if (!entry.primitives) continue
        const gone = new Set(entry.primitives)
        let at = 0
        for (const primitive of list) if (!gone.has(primitive)) list[at++] = primitive
        list.length = at
        changes++
      }
    },
  }
  return { metadata, pages }
}
