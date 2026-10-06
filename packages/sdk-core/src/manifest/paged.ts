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
import { createPageHolds, type ManifestPages, type PageAsk } from './pagedHolds.ts'

export type { ManifestPages, PageAsk } from './pagedHolds.ts'

/** The manifest's pages: a mesh page lists its slim primitives. */
const MANIFEST_PAGES: PageKind = {
  prefix: 'manifest-page-',
  version: MANIFEST_BINARY_VERSION,
  records: 'primitives',
  unsupported: 'UNSUPPORTED_FORMAT',
  invalid: 'INVALID_CACHE',
}

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

/**
 * The manifest under `root` with its head read and no mesh page: its primitives are those
 * of the pages `pages` holds (`pagedHolds.ts`), read through `read` on their first hold and passed
 * through `accept` — which checks and places them — before they join `metadata.primitives`; a page
 * none holds any longer lets its files go through `letGo`.
 */
export async function openPagedManifest(
  root: Record<string, unknown>,
  read: Read,
  accept: (primitives: Primitive[]) => Primitive[] = (primitives) => primitives,
  letGo: (page: TablePage) => void = () => {},
): Promise<{ metadata: ClusterManifest; pages: ManifestPages }> {
  const { head, fixed } = split(root)
  const [body] = await readLeaves(MANIFEST_PAGES, head, read)
  const { metadata, decode } = headed(fixed, await withSidecar(body, read))
  /** `slot`'s page and sidecar read as `asked`, each file told `seen`: its primitives, checked. */
  const load = async (slot: string, asked: PageAsk, seen: (page: TablePage) => void) => {
    const own = (page: TablePage) => (seen(page), read(page, asked))
    const [page] = await readLeaves(MANIFEST_PAGES, named(MANIFEST_PAGES, [slot]), own)
    return accept(decode(await withSidecar(page, own)).primitives)
  }
  return { metadata, pages: createPageHolds(load, metadata.primitives, letGo, read) }
}
