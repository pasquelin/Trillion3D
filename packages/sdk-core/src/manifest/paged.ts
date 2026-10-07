/** The manifest as a page tree (`compiler_manifest_pages.rs`, FORMAT.md): the fixed-size root
 *  `clusters.json`, its head page (every other field, the previews' sidecar) and its mesh pages
 *  (slim primitives, their sidecar), read whole through the scene partition's pager
 *  (`tablePartition.ts`, `readPagedManifest`). */
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
async function withSidecar(body: Body, read: (page: TablePage) => Promise<Uint8Array>) {
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
