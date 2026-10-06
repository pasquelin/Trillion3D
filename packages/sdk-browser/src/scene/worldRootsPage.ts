/**
 * THE WORLD SUPER-ROOT PAGES AS THE ENGINES DRAW THEM.
 *
 * A world page (`world-roots.bin`, docs/FORMAT.md, World super-roots) is not a `WGP3`
 * geometry page: it holds its vertices as three world-space `f32` and its triangles as `u16`
 * LOCAL indices. Neither engine can upload it as it stands — the WebGPU pool and its shader index
 * an `array<u32>`, WebGL2's cluster draw hard-codes `UNSIGNED_INT`
 * (`webgl/cluster/submit.ts`) — so this module is the ONE detached page source that turns a page,
 * read at its world address (`worldRootsPageAddress`, `worldPageServe.ts`), into the shape each
 * engine already uploads, binds and draws, no second draw stack and no second BVH (rule 7):
 *
 *  - `geometry`: a `DecodedGeometryPage` — its `u16` indices widened one-to-one to `u32`, its
 *    world-space positions, no other attribute — over the WebGL2 geometry path (`hostPageGeometry`);
 *  - `read` and `attributes`: the same widened indices as the bytes a GPU page slot holds
 *    (`PageSource.read`), and the world-space positions as the `HostAttributes` the WebGPU float
 *    pool packs.
 *
 * A page is addressed by its place in the bulk data (its bundle and its byte offset), and a bundle
 * is streamed once: its read serves every caller and both WebGPU views of each page (`read` and
 * `attributes`), whatever their order; what stays resident is the caller's (`openWorldRoots`: the
 * pinned top and the bundles the placed cells hold, like a loaded cell's data) and the GPU page
 * pool's, never a second cache here.
 *
 * The world matrix stays the identity: the positions are already in world space, so a page is
 * bound and drawn as it was cooked, never placed by a per-cluster pose.
 */
import type { PageSource } from '../../../sdk-core/src/contracts/cache.ts'
import type { HostAttributes } from '../host/resources.ts'
import { BufferAttribute } from '../../../sdk-core/src/world/buffer/attribute.ts'
import { hostPageGeometry } from '../host/pageObjects.ts'
import { Box3 } from '../../../sdk-core/src/world/math/box3.ts'
import type { WorldPageServer } from './worldPageServe.ts'

/**
 * The detached page source over `server` (`worldPageServe.ts`, the world stream's family, which
 * resolves, reads and widens each page): each page served in the shape each engine already
 * uploads, binds and draws.
 */
export function worldRootsPageSource(server: WorldPageServer) {
  const source = {
    keptBytes: server.keptBytes,
    page: server.page,
    read: server.read,
    /** Its world-space positions as the WebGPU float pool packs a block. */
    attributes: async (address: string, signal?: AbortSignal): Promise<HostAttributes> => ({
      position: new BufferAttribute(await server.positions(address, signal), 3),
    }),
    /** The WebGL2 geometry it is drawn as: its decoded shape over the engine's own geometry,
     *  bounded by the box its world-space positions span (no pose: the matrix is the identity). */
    geometry: async (address: string, signal?: AbortSignal) => {
      const decoded = await server.decoded(address, signal),
        box = new Box3().setFromArray(decoded.attributes.position)
      return hostPageGeometry(decoded, () => 3, box.min.toArray(), box.max.toArray())
    },
  }
  return source satisfies PageSource
}
