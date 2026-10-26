import { checkGeometryPage } from '../../geometry/codec/geometryPage.ts'
import { checkVoxelPage, isVoxelPage } from '../../../../sdk-core/src/page/voxelPage.ts'
import { requireSdkWasm } from '../../wasm/sdkWasm.ts'
import type { WebgpuPagesCore } from './runtime.ts'

/**
 * The bytes one pool slot holds for a cluster: its quantized geometry page, on disk, read from the
 * host's page reader at the address the manifest gives it — the install pass transcodes it into the
 * slot —, or — for a cache that carries no geometry page — the index page the arrival already left
 * in memory. The slot is written from one of the two, never from both, at the admission's
 * `priority`; a load cancelled drops its read while it waits.
 */
export function createPageSource(rt: WebgpuPagesCore) {
  const { context, setup } = rt,
    { sourceBytes, geometryUrls, census } = setup
  // Every geometry page — a primitive's or a world HLOD actor's — is a slice of a bundle the
  // session's one reader serves (`../../geometry/streaming/pageStreamer.ts`).
  const readGeometry = (url: string, signal?: AbortSignal, priority?: number) =>
    context.readGeometryPage
      ? context.readGeometryPage(url, signal, priority)
      : Promise.reject(new Error('Missing geometry page reader'))
  const read = async (key: string, signal?: AbortSignal, priority?: number) => {
    const geometryUrl = geometryUrls.get(key)
    if (geometryUrl === undefined)
      return sourceBytes.get(key) ?? Promise.reject(new Error('Missing page'))
    const bytes = await readGeometry(geometryUrl, signal, priority)
    // The install pass transcodes these words and the shaders decode the result in place, so
    // nothing downstream would ever notice a forged or truncated page. The format's own gate is
    // read here, once per admission: magic, version, grids, counts that measure exactly this many
    // bytes, and every field read back. A page that fails it is refused through the loader's error
    // path, never installed; nor is one that would take more of the pool than the place the manifest
    // gives it. A voxel brick has its own gate (`checkVoxelPage`): its head and its count measure it.
    if (isVoxelPage(bytes)) checkVoxelPage(bytes)
    else {
      const page = checkGeometryPage(await requireSdkWasm(), bytes)
      if (page.residentBytes !== census.homes.get(key)) throw new Error('PAGE_SIZE_MISMATCH')
    }
    return bytes
  }
  return { read }
}
