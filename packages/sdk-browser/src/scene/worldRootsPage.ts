/**
 * THE WORLD SUPER-ROOT PAGES AS THE ENGINES DRAW THEM (#1238).
 *
 * A world page (`world-roots.bin`, docs/FORMAT.md, World super-roots; #23, #1237) is not a `WGP3`
 * geometry page: it holds its vertices as three world-space `f32` and its triangles as `u16`
 * LOCAL indices. Neither engine can upload it as it stands — the WebGPU pool and its shader index
 * an `array<u32>`, WebGL2's cluster draw hard-codes `UNSIGNED_INT`
 * (`webgl/cluster/submit.ts`) — so this module is the ONE detached page source that turns a page,
 * read at its world address (`${payload.url}#${bundle}:${offset}`, `scene/worldSuperRoots.ts`),
 * into the shape each engine already uploads, binds and draws, no second draw stack and no second
 * BVH (AGENTS.md rule 7):
 *
 *  - a `DecodedGeometryPage` — its `u16` indices widened one-to-one to `u32`, its world-space
 *    positions, no other attribute — for the WebGL2 geometry path (`hostPageGeometry`);
 *  - the same widened indices as the bytes a GPU page slot holds (`PageSource.read`), with the
 *    world-space positions as a `HostAttributes` list, for the WebGPU float pool and page cache.
 *
 * The world matrix stays the identity: the positions are already in world space, so a page is
 * bound and drawn as it was cooked, never placed by a per-cluster pose (#1238).
 */
import { worldBundlePages, type WorldRoots, type WorldRootsPage } from '../../../sdk-core/src/manifest/worldRoots.ts';
import type { DecodedGeometryPage } from '../page/decode/geometryPage.ts';
import type { PageSource } from '../../../sdk-core/src/index.ts';
import type { HostAttributes } from '../host/resources.ts';
import { BufferAttribute } from '../../../sdk-core/src/world/buffer/attribute.ts';
import { hostPageGeometry } from '../host/pageObjects.ts';
import type { Geometry } from '../../../sdk-core/src/world/geometry/geometry.ts';

/** The world address of one page: its binary, its bundle and its byte offset inside that bundle. */
export const worldRootsPageAddress = (payloadUrl: string, bundle: number, offset: number) =>
  `${payloadUrl || 'world-roots.bin'}#${bundle}:${offset}`;

/** The bundle and the offset inside it that a world page address names. */
export function worldRootsPageLocation(address: string): { bundle: number; offset: number } {
  const at = address.lastIndexOf('#'),
    [bundle, offset] = address
      .slice(at < 0 ? 0 : at + 1)
      .split(':')
      .map(Number);
  if (!Number.isSafeInteger(bundle) || !Number.isSafeInteger(offset))
    throw new Error(`WORLD_PAGE_ADDRESS: ${address}`);
  return { bundle, offset };
}

/** Reads `length` bytes of the world binary at `from`: the one ranged read the source makes. */
export type WorldRootsByteReader = (
  from: number,
  length: number,
  signal?: AbortSignal,
) => Promise<Uint8Array>;

/** The detached page source of a world table: a `PageSource` (its `read` hands the widened index
 *  words to a GPU slot), the raw page at its address, and its decoded geometry-page shape. */
export type WorldRootsPageSource = PageSource & {
  /** The page at `address`, read from its bundle once and kept: world-space vertices, `u16`
   *  triangles. */
  page(address: string, signal?: AbortSignal): Promise<WorldRootsPage>;
  /** Its shape as a decoded geometry page (`DecodedGeometryPage`): `u32` indices, a position list. */
  decoded(address: string, signal?: AbortSignal): Promise<DecodedGeometryPage>;
};

/** The `u32` indices of a world page: the `u16` local list widened one-to-one, the width both the
 *  WebGPU `array<u32>` and WebGL2's `UNSIGNED_INT` draw read. */
export const worldRootsIndices = (page: WorldRootsPage) => Uint32Array.from(page.indices);

/**
 * The page source of `table`, reading its binary through `read`: a page is resolved at its world
 * address by decoding its bundle once (`worldBundlePages`, the raw reader the cook's bytes feed)
 * and picking the page whose offset the table lists.
 */
export function worldRootsPageSource(
  table: WorldRoots,
  read: WorldRootsByteReader,
): WorldRootsPageSource {
  const bundles = new Map<number, Promise<WorldRootsPage[]>>();
  const bundlePages = (bundle: number, signal?: AbortSignal) => {
    let known = bundles.get(bundle);
    if (!known) {
      const range = table.bundles[bundle];
      known = read(range.offset, range.bytes, signal).then((bytes) =>
        worldBundlePages(bytes, range.count, bundle),
      );
      bundles.set(bundle, known);
    }
    return known;
  };
  const at = (bundle: number, offset: number) =>
    table.pages
      .filter((entry) => entry.bundle === bundle)
      .sort((a, b) => a.offset - b.offset)
      .findIndex((entry) => entry.offset === offset);
  const page = async (address: string, signal?: AbortSignal) => {
    const { bundle, offset } = worldRootsPageLocation(address),
      pages = await bundlePages(bundle, signal),
      index = at(bundle, offset);
    if (index < 0 || index >= pages.length) throw new Error(`WORLD_PAGE_MISSING: ${address}`);
    return pages[index];
  };
  return {
    page,
    decoded: async (address, signal) => decodedWorldRootsPage(await page(address, signal)),
    read: async (key, signal) => new Uint8Array(worldRootsIndices(await page(key, signal)).buffer),
  };
}

/** The engine's decoded shape of a world page: `u32` indices, a world-space position list, and no
 *  other attribute — the world page carries no normal, UV or colour. */
export function decodedWorldRootsPage(page: WorldRootsPage): DecodedGeometryPage {
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

/** The world-space position list of a page, as the WebGPU float pool reads a block (`HostAttributes`),
 *  packed into the engine's own attribute objects. */
export const worldRootsAttributes = (page: WorldRootsPage): HostAttributes => ({
  position: new BufferAttribute(page.positions, 3),
});

/** The world-space box a page spans: its positions are already world-space, so this box needs no
 *  pose and the identity matrix is the page's. */
export function worldRootsBounds(page: WorldRootsPage) {
  const positions = page.positions,
    min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3)
    for (let c = 0; c < 3; c++) {
      const value = positions[i + c];
      if (value < min[c]) min[c] = value;
      if (value > max[c]) max[c] = value;
    }
  return { min, max };
}

/** The WebGL2 geometry a world page is drawn as: its decoded shape over the engine's own geometry
 *  (`hostPageGeometry`), bounded by the box its world-space positions span. */
export function worldRootsGeometry(page: WorldRootsPage): Geometry {
  const { min, max } = worldRootsBounds(page);
  return hostPageGeometry(decodedWorldRootsPage(page), () => 3, min, max);
}
