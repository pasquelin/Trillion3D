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
 * byte offset), and concurrent requests of one bundle share one read; what stays resident is the
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
  const at = address.lastIndexOf('#'),
    parts = address.slice(at < 0 ? 0 : at + 1).split(':'),
    bundle = Number(parts[0]),
    offset = Number(parts[1]);
  if (
    parts.length !== 2 ||
    !parts[0] ||
    !parts[1] ||
    !Number.isSafeInteger(bundle) ||
    !Number.isSafeInteger(offset) ||
    bundle < 0 ||
    offset < 0
  )
    throw new Error(`WORLD_PAGE_ADDRESS: ${address}`);
  return { bundle, offset };
}

/** The pages of one bundle of the table, verified, in binary order. */
type BundlePages = (bundle: number) => Promise<WorldRootsPage[]>;

/** The `u32` indices of a world page: the `u16` local list widened one-to-one, the width both the
 *  WebGPU `array<u32>` and WebGL2's `UNSIGNED_INT` draw read. */
const worldRootsIndices = (page: WorldRootsPage) => Uint32Array.from(page.indices);

/**
 * The detached page source of `table`, its bundles read through `bundlePages`: a page is resolved
 * at its world address by the pages of its bundle and the rank of its offset among those the table
 * lists for that bundle. A bundle the table does not list, or an offset it does not name, is
 * `WORLD_PAGE_MISSING`.
 */
export function worldRootsPageSource(table: WorldRoots, bundlePages: BundlePages) {
  const pending = new Map<number, Promise<WorldRootsPage[]>>();
  // A bundle's read in flight is shared by every caller, so it carries no caller's signal: one
  // caller aborting must not fail another's page (`page` checks its own signal after the read).
  const shared = (bundle: number) => {
    if (!table.bundles[bundle])
      return Promise.reject(new Error(`WORLD_PAGE_MISSING: bundle ${bundle}`));
    let known = pending.get(bundle);
    if (!known) {
      known = bundlePages(bundle);
      pending.set(bundle, known);
      // Settled, the read is let go: what stays resident is the holder's and the GPU pool's.
      const settle = () => void (pending.get(bundle) === known && pending.delete(bundle));
      void known.then(settle, settle);
    }
    return known;
  };
  // Each page's rank inside its bundle, in binary order: the table lists every page's offset.
  const rankInBundle = new Map<string, number>();
  const byBundle = new Map<number, number[]>();
  for (const entry of table.pages) {
    const offsets = byBundle.get(entry.bundle) ?? [];
    offsets.push(entry.offset);
    byBundle.set(entry.bundle, offsets);
  }
  for (const [bundle, offsets] of byBundle)
    offsets
      .sort((a, b) => a - b)
      .forEach((offset, index) => rankInBundle.set(`${bundle}:${offset}`, index));
  const page = async (address: string, signal?: AbortSignal) => {
    const { bundle, offset } = worldRootsPageLocation(address),
      pages = await shared(bundle),
      index = rankInBundle.get(`${bundle}:${offset}`) ?? -1;
    signal?.throwIfAborted();
    if (index < 0 || index >= pages.length) throw new Error(`WORLD_PAGE_MISSING: ${address}`);
    return pages[index];
  };
  const source = {
    /** The page at `address`: world-space vertices, `u16` triangles. */
    page,
    /** The bytes a GPU page slot holds: the page's widened `u32` index words. */
    read: async (key: string, signal?: AbortSignal) =>
      new Uint8Array(worldRootsIndices(await page(key, signal)).buffer),
    /** Its world-space positions as the WebGPU float pool packs a block. */
    attributes: async (address: string, signal?: AbortSignal): Promise<HostAttributes> => ({
      position: new BufferAttribute((await page(address, signal)).positions, 3),
    }),
    /** The WebGL2 geometry it is drawn as: its decoded shape over the engine's own geometry,
     *  bounded by the box its world-space positions span (no pose: the matrix is the identity). */
    geometry: async (address: string, signal?: AbortSignal) => {
      const decoded = decodedWorldRootsPage(await page(address, signal)),
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
