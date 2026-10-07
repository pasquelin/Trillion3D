/**
 * THE WORLD SUPER-ROOT PAGES AS THE ENGINE DRAWS THEM (#1238).
 *
 * A world page (`world-roots.bin`, docs/FORMAT.md, World super-roots) is a `WGP3` geometry page:
 * its vertices in world space, with the normals, texture coordinates and colour of the objects it
 * stands for. This module is the ONE detached page source over the world page server
 * (`worldPageServe.ts`), read at a page's world address (`worldRootsPageAddress`), in the shape the
 * engine already uploads, binds and draws, no second draw stack and no second BVH (rule 7): `read`
 * gives the page's own bytes, which a WebGPU page slot holds and its shaders decode in place, as
 * any geometry page's (`PageSource.read`).
 *
 * A page is addressed by its place in the bulk data (its bundle and its byte offset), and a bundle
 * read in flight serves every caller; what stays resident is the caller's (`openWorldRoots`: the
 * pinned top and the bundles the placed cells hold, like a loaded cell's data) and the GPU page
 * pool's, never a second cache here.
 *
 * The world matrix stays the identity: the positions are already in world space, so a page is
 * bound and drawn as it was cooked, never placed by a per-cluster pose.
 */
import type { PageSource } from '../../../sdk-core/src/contracts/cache.ts'
import type { WorldPageServer } from './worldPageServe.ts'

/**
 * The detached page source over `server` (`worldPageServe.ts`, the world stream's family, which
 * resolves and reads each page): each page served in the shape the engine already uploads, binds
 * and draws.
 */
export function worldRootsPageSource(server: WorldPageServer) {
  const source = {
    keptBytes: server.keptBytes,
    page: server.page,
    read: server.read,
  }
  return source satisfies PageSource
}
