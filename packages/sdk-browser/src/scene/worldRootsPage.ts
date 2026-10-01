/**
 * THE WORLD SUPER-ROOT PAGES AS THE ENGINES DRAW THEM (#1238).
 *
 * A world page (`world-roots.bin`, docs/FORMAT.md, World super-roots; #23, #1237) is not a `WGP3`
 * geometry page: it holds its vertices as three world-space `f32` and its triangles as `u16`
 * LOCAL indices. Neither engine can upload it as it stands — the WebGPU pool and its shader index
 * an `array<u32>`, WebGL2's cluster draw hard-codes `UNSIGNED_INT`
 * (`webgl/cluster/submit.ts`) — so this module is the ONE detached page source that turns a page,
 * read at its world address (`worldRootsPageAddress`), into the shape each engine already uploads,
 * binds and draws, no second draw stack and no second BVH (AGENTS.md rule 7):
 *
 *  - `geometry`: a `DecodedGeometryPage` — its `u16` indices widened one-to-one to `u32`, its
 *    world-space positions, no other attribute — over the WebGL2 geometry path (`hostPageGeometry`);
 *  - `read` and `attributes`: the same widened indices as the bytes a GPU page slot holds
 *    (`PageSource.read`), and the world-space positions as the `HostAttributes` the WebGPU float
 *    pool packs.
 *
 * As Nanite's streamer does, a page is addressed by its place in the bulk data (its bundle and its
 * byte offset), and a bundle is streamed once: its read serves every caller and both WebGPU views
 * of each page (`read` and `attributes`), whatever their order; what stays resident is the
 * caller's (`openWorldRoots`: the pinned top and the bundles the placed cells hold, as World
 * Partition keeps a loaded cell's data) and the GPU page pool's, never a second cache here.
 *
 * The world matrix stays the identity: the positions are already in world space, so a page is
 * bound and drawn as it was cooked, never placed by a per-cluster pose.
 */
import {
  WORLD_ROOTS_BIN,
  type WorldRoots,
  type WorldRootsPage,
} from '../../../sdk-core/src/manifest/worldRoots.ts';
import type { PageSource } from '../../../sdk-core/src/contracts/cache.ts';
import type { DecodedGeometryPage } from '../page/decode/geometryPage.ts';
import type { HostAttributes } from '../host/resources.ts';
import { BufferAttribute } from '../../../sdk-core/src/world/buffer/attribute.ts';
import { hostPageGeometry } from '../host/pageObjects.ts';
import { Box3 } from '../../../sdk-core/src/world/math/box3.ts';

/** The world address of one page: its binary, its bundle and its byte offset inside that bundle. */
export const worldRootsPageAddress = (payloadUrl: string, bundle: number, offset: number) =>
  `${payloadUrl || WORLD_ROOTS_BIN}#${bundle}:${offset}`;

/** The bundle and the offset inside it that a world page address names. */
function worldRootsPageLocation(address: string): { bundle: number; offset: number } {
  const named = /#(\d+):(\d+)$/.exec(address);
  if (!named) throw new Error(`WORLD_PAGE_ADDRESS: ${address}`);
  return { bundle: Number(named[1]), offset: Number(named[2]) };
}

/** The pages of one bundle of the table, verified, in binary order. */
type BundlePages = (bundle: number) => Promise<WorldRootsPage[]>;

/** What a caller takes of a page: one of its two WebGPU halves, or the whole page at once. */
type View = 'read' | 'attributes' | 'whole';

/** The `u32` indices of a world page: the `u16` local list widened one-to-one, the width both the
 *  WebGPU `array<u32>` and WebGL2's `UNSIGNED_INT` draw read. */
const worldRootsIndices = (page: WorldRootsPage) => new Uint32Array(page.indices);

/**
 * The detached page source of `table`, its bundles read through `bundlePages`: a page is resolved
 * at its world address by the pages of its bundle and the rank of its offset among those the table
 * lists for that bundle. A bundle the table does not list, or an offset it does not name, is
 * `WORLD_PAGE_MISSING`.
 */
export function worldRootsPageSource(table: WorldRoots, bundlePages: BundlePages) {
  // Each bundle's page offsets in binary order: a page's rank among them is its place in the bundle.
  const offsets = new Map<number, number[]>();
  for (const entry of table.pages) {
    const known = offsets.get(entry.bundle);
    if (known) known.push(entry.offset);
    else offsets.set(entry.bundle, [entry.offset]);
  }
  for (const known of offsets.values()) known.sort((a, b) => a - b);
  /** A bundle read once: its pages, the callers still on it, and each page whose GPU half (`read`
   *  or `attributes`) is served and whose other half is still owed. */
  type Streamed = { pages: Promise<WorldRootsPage[]>; users: number; owed: Map<number, View> };
  const streamed = new Map<number, Streamed>();
  // A bundle's read is shared by every caller, so it carries no caller's signal: one caller
  // aborting must not fail another's page (`serve` checks its own signal after the read). It is
  // let go once no caller is on it and no page owes a view, so the two GPU views of a page come
  // from one read whatever their order; what stays resident is the holder's and the GPU pool's.
  const serve = async (address: string, view: View, signal?: AbortSignal) => {
    const { bundle, offset } = worldRootsPageLocation(address);
    if (!table.bundles[bundle]) throw new Error(`WORLD_PAGE_MISSING: bundle ${bundle}`);
    let own = streamed.get(bundle);
    if (!own) {
      streamed.set(bundle, (own = { pages: bundlePages(bundle), users: 0, owed: new Map() }));
      const failed = own;
      failed.pages.catch(() => void (streamed.get(bundle) === failed && streamed.delete(bundle)));
    }
    own.users++;
    try {
      const pages = await own.pages,
        index = offsets.get(bundle)?.indexOf(offset) ?? -1;
      signal?.throwIfAborted();
      if (index < 0 || index >= pages.length) throw new Error(`WORLD_PAGE_MISSING: ${address}`);
      const other = own.owed.get(index);
      if (view === 'whole' || (other && other !== view)) own.owed.delete(index);
      else own.owed.set(index, view);
      return pages[index];
    } finally {
      if (--own.users === 0 && own.owed.size === 0 && streamed.get(bundle) === own)
        streamed.delete(bundle);
    }
  };
  const source = {
    /** The page at `address`: world-space vertices, `u16` triangles. */
    page: (address: string, signal?: AbortSignal) => serve(address, 'whole', signal),
    /** The bytes a GPU page slot holds: the page's widened `u32` index words. */
    read: async (key: string, signal?: AbortSignal) =>
      new Uint8Array(worldRootsIndices(await serve(key, 'read', signal)).buffer),
    /** Its world-space positions as the WebGPU float pool packs a block. */
    attributes: async (address: string, signal?: AbortSignal): Promise<HostAttributes> => ({
      position: new BufferAttribute((await serve(address, 'attributes', signal)).positions, 3),
    }),
    /** The WebGL2 geometry it is drawn as: its decoded shape over the engine's own geometry,
     *  bounded by the box its world-space positions span (no pose: the matrix is the identity). */
    geometry: async (address: string, signal?: AbortSignal) => {
      const decoded = decodedWorldRootsPage(await serve(address, 'whole', signal)),
        box = new Box3().setFromArray(decoded.attributes.position);
      return hostPageGeometry(decoded, () => 3, box.min.toArray(), box.max.toArray());
    },
  };
  return source satisfies PageSource;
}

/** The engine's decoded shape of a world page: `u32` indices, a world-space position list, and no
 *  other attribute — the world page carries no normal, UV or colour. */
function decodedWorldRootsPage(page: WorldRootsPage): DecodedGeometryPage {
  const indices = worldRootsIndices(page),
    positions = page.positions as Float32Array<ArrayBuffer>;
  return {
    indices,
    attributes: { position: positions },
    vertexCount: positions.length / 3,
    flags: 0,
    decodedBytes: positions.byteLength + indices.byteLength,
    quantizationError: 0,
  };
}
