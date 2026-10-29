import type { TrackedRoot } from '../distanceField/objectTable.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { sizedBuffer } from '../../gpu/core/sizedBuffer.ts'
import { standInBuffer, standInTexture } from '../../gpu/core/standIns.ts'
import { atlasFormats } from '../surfaceCache/layout.ts'
import { WORD_LIGHT_FORMAT, type LightAtlasFormat } from '../../gpu/core/lightAtlasFormat.ts'
import { instanceWords } from './hitInstances.ts'
import type { SurfaceHitResources } from '../surfaceCache/hitWgsl.ts'
import { cacheRootsOf } from '../surfaceCache/placements.ts'
import { sameValues } from '../../../../math/src/matrix/matrixElements.ts'

/**
 * WHAT THE RAYS' HITS READ OF THE SURFACE CACHE (`../surfaceCache/hitWgsl.ts`), as the resources a pass binds
 * (`SurfaceHitResources`): the cache's tables and the layers of its atlas a hit reads, the feedback buffer its reads write
 * (`../surfaceCache/feedbackBuffer.ts`), the global field's object grid, and the table from an object of the grid to
 * its placement in the cache (`hitInstances.ts`), rewritten when the roots the cache follows or the cache's
 * placements changed.
 *
 * Where the cache is not made — a session with no cards, the image before the first the cache was asked for —
 * every one is a stand-in: tables whose header holds nothing, so a hit finds no mesh cards, and the field answers the
 * ray. A compressed atlas changes only the layers no hit reads. The final light is stored in the format the atlases' light is (`lightAtlasFormat`):
 * the stand-in of a format is a texel of it, as the cache's own.
 */

const WORD = 4

/** The stand-ins of a device: zero tables, a texel of each layer a hit reads (the final light's of the format asked), empty feedback, grid and instances. */
function createStandIns(device: GPUDevice) {
  const buffer = (label: string, bytes: number) =>
    standInBuffer(device, `Trillion3D reflection hit, no ${label}`, bytes, GPUBufferUsage.STORAGE)
  const view = (layer: string, format: GPUTextureFormat) =>
    standInTexture(device, `Trillion3D reflection hit, no ${layer}`, format).createView()
  const shared = {
    tables: buffer('tables', 64 * WORD),
    depth: view('depth', atlasFormats(false, WORD_LIGHT_FORMAT).depth),
    albedo: view('albedo', atlasFormats(false, WORD_LIGHT_FORMAT).albedo),
    normal: view('normal', atlasFormats(false, WORD_LIGHT_FORMAT).normal),
    emissive: view('emissive', atlasFormats(false, WORD_LIGHT_FORMAT).emissive),
    indirect: view('indirect', atlasFormats(false, WORD_LIGHT_FORMAT).indirect),
    frames: view('frames', atlasFormats(false, WORD_LIGHT_FORMAT).frames),
    factors: buffer('factors', 64 * WORD),
    feedback: buffer('feedback', 64 * WORD),
    grid: buffer('grid', 16),
    instances: buffer('instances', 16),
  }
  const ofLight = new Map<LightAtlasFormat, SurfaceHitResources>()
  return {
    shared,
    /** The stand-ins whose final light is a texel of `light`. */
    resources(light: LightAtlasFormat): SurfaceHitResources {
      let held = ofLight.get(light)
      if (!held)
        ofLight.set(
          light,
          (held = { ...shared, final: view('final', light), direct: view('direct', light) }),
        )
      return held
    },
    dispose() {
      for (const resource of [
        shared.tables,
        shared.factors,
        shared.feedback,
        shared.grid,
        shared.instances,
      ])
        resource.destroy()
    },
  }
}

/** What the placements' table keeps between images. */
interface InstanceTable {
  buffer: GPUBuffer
  /** The words held on the GPU, and the scratch the next image's are made in. */
  uploaded: Uint32Array<ArrayBuffer>
  scratch: Uint32Array<ArrayBuffer>
}

/** The surface cache of `rt` where it is made and its tables written — what a hit can read —, else none. */
export function readableCache(rt: Pick<WebgpuPagesRuntime, 'surfaceCache'>) {
  const state = rt.surfaceCache
  return state?.atlases && state.tables.buffer ? state : undefined
}

/** The table from the grid's objects to the cache's placements (`hitInstances.ts`) on `device`. */
function createInstanceTable(device: GPUDevice) {
  let table: InstanceTable | undefined
  let rankedRoots: readonly TrackedRoot[] | undefined
  let rankedCount = -1
  const ranks = new Map<TrackedRoot, number>()
  const rankOf = (root: TrackedRoot) => ranks.get(root)

  /** The instance of each root of `roots`, read again only when the list changed. */
  function rank(roots: readonly TrackedRoot[]) {
    if (roots === rankedRoots && roots.length === rankedCount) return
    rankedRoots = roots
    rankedCount = roots.length
    ranks.clear()
    roots.forEach((root, at) => void (ranks.has(root) || ranks.set(root, at)))
  }

  return {
    /** The buffer of the table of `rt`'s placements, written where it changed. */
    update(rt: WebgpuPagesRuntime, state: NonNullable<WebgpuPagesRuntime['surfaceCache']>) {
      rank(cacheRootsOf(rt))
      const words = instanceWords(
        state.cache.placements.keys(),
        state.placements.rootsOf,
        rankOf,
        table?.scratch ?? new Uint32Array(0),
      )
      const count = 1 + words[0]
      if (table && sameValues(table.uploaded, words.subarray(0, count))) return table.buffer
      const held = table
      const buffer = sizedBuffer(
        device,
        held?.buffer,
        Math.max(16, count * WORD),
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        'Trillion3D reflection hit instances',
      )
      // A buffer made anew holds nothing yet: the table is written whole.
      const next: InstanceTable =
        held && buffer === held.buffer
          ? held
          : { buffer, uploaded: new Uint32Array(0), scratch: words }
      next.scratch = words
      next.uploaded = words.slice(0, count)
      device.queue.writeBuffer(buffer, 0, next.uploaded)
      table = next
      return buffer
    },
    dispose() {
      table?.buffer.destroy()
      table = undefined
    },
  }
}

/** The reads of the surface cache the rays' hits make, made once a device. */
export function createHitCards(device: GPUDevice) {
  let stand: ReturnType<typeof createStandIns> | undefined
  const instances = createInstanceTable(device)
  /** What the image binds where the cache is made: written in place each image. */
  const current = {} as { -readonly [K in keyof SurfaceHitResources]: SurfaceHitResources[K] }
  return {
    /** What the scene stage's hits of the image bind, for the final light stored in `light`: the cache's where it is made in that format, the stand-ins where it is not. */
    resources(rt: WebgpuPagesRuntime, light: LightAtlasFormat): SurfaceHitResources {
      stand ??= createStandIns(device)
      const state = readableCache(rt)
      if (!state || state.atlases!.light !== light) return stand.resources(light)
      const { physical } = state.atlases!
      // Only the main view writes the cache's feedback (`feedbackBuffer.ts`).
      const main = rt.views.active === rt.views.main
      current.tables = state.tables.buffer!
      current.depth = physical.depth
      current.final = physical.final
      current.albedo = physical.albedo
      current.normal = physical.normal
      current.emissive = physical.emissive
      current.direct = physical.direct
      current.indirect = physical.indirect
      current.frames = physical.frames
      current.factors = state.atlases!.factors
      current.feedback = (main && state.feedback.buffer) || stand.shared.feedback
      current.grid = rt.distanceFields?.scene.field.resources?.objectGrid ?? stand.shared.grid
      current.instances = instances.update(rt, state)
      return current
    },
    dispose() {
      stand?.dispose()
      instances.dispose()
      stand = undefined
    },
  }
}
