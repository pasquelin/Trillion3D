import { BOUNCE_SETTINGS } from '../../../../sdk-core/src/bounce/contracts.ts'
import type { BounceCascades } from '../../../../sdk-core/src/bounce/cascades.ts'
import { applyMarks, markWords } from '../../../../sdk-core/src/bounce/probeMarks.ts'
import type { ProbePool } from '../../../../sdk-core/src/bounce/probePool.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { createReadbackRing } from '../../gpu/core/readbackRing.ts'
import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import { buildComputeStage } from '../../gpu/core/computeStages.ts'
import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import {
  computeBufferEntry,
  computeTextureEntry,
  namedEntries,
} from '../../gpu/core/computeBindings.ts'
import { atlasEntry } from './atlas.ts'
import { BOUNCE_MARK_SHADER, MARK_GROUP } from './markWgsl.ts'
import { MARK_BINDINGS } from './probes/probeBindings.ts'

/** Marks in flight at once: one an image at most, never a wait. */
const IN_FLIGHT = 3

/** Numbers that tell the image's surfaces changed: the camera's view matrix and projection (16 words
 *  each), then the nine of what the image draws (`frame/render/encodeLights.ts`, `drawnSurface`). */
const MARK_SIGNATURE = 32 + 9

/** What the mark pass reads of the image: its depth and its normals, the view's uniform, the size it was
 *  drawn at and the signature of what it drew — a camera that moved, a cut that changed, rows that
 *  arrived: a surface the marks have not seen. Filled in place each image. */
export type MarkSurface = {
  /** The view the image is of: each view is watched for its own change, so that views drawn in turn
   *  never look like a view that moves. */
  key: object | undefined
  depth: GPUTextureView | undefined
  normals: GPUTextureView | undefined
  view: GPUBuffer | undefined
  size: [number, number]
  /** `MARK_SIGNATURE` numbers, compared to the last mark's. */
  signature: Float64Array
}

/** A surface with nothing in it yet. */
export const createMarkSurface = (): MarkSurface => ({
  key: undefined,
  depth: undefined,
  normals: undefined,
  view: undefined,
  size: [0, 0],
  signature: new Float64Array(MARK_SIGNATURE),
})

/** What the marks that came back did: how many came back, and the cells named by the last one. */
type MarkStats = { reads: number; cells: number }

/** What a bitmap in flight remembers: the image it was made in and the lowest cell of each level then,
 *  the window its bits name their cells in (`applyMarks`). */
type MarkTag = { frame: number; bases: Int32Array }

/** The mark pass's layout and pipeline, compiled off the thread. */
async function compileMarks(device: GPUDevice) {
  const module = await createCheckedShaderModule(device, BOUNCE_MARK_SHADER, 'BOUNCE_MARK')
  const B = MARK_BINDINGS
  const layout = device.createBindGroupLayout({
    entries: [
      computeBufferEntry(B.grid, 'uniform'),
      atlasEntry(B.probes),
      computeBufferEntry(B.view, 'uniform'),
      computeTextureEntry(B.depth, 'depth', '2d'),
      computeTextureEntry(B.normals, 'unfilterable-float', '2d'),
      computeBufferEntry(B.marks, 'storage'),
    ],
  })
  return { layout, pipeline: await buildComputeStage(device, [layout], module, 'markCells') }
}

/**
 * The ring the bitmaps come back through (`../../gpu/core/readbackRing.ts`): a few images later each
 * lands in the pool (`applyMarks`) in the window it was made in — its tag holds the lowest cell of
 * each level then — and the probes no mark read for a while are given back. `take` hands the staging
 * buffer of image `frame`, none while all are in flight; the tags are one more than the ring holds
 * buffers, so that a tag a read still holds is never filled again.
 */
function createMarkRing(
  device: GPUDevice,
  cascades: BounceCascades,
  pool: ProbePool,
  bytes: number,
  stats: MarkStats,
) {
  const levels = cascades.levels.length
  const tags: MarkTag[] = Array.from({ length: IN_FLIGHT + 1 }, () => ({
    frame: 0,
    bases: new Int32Array(levels * 3),
  }))
  let next = 0
  const ring = createReadbackRing<MarkTag>(
    device,
    { label: 'Trillion3D bounce marks readback', bytes, count: IN_FLIGHT },
    (mapped, _staging, tag) => {
      stats.cells = applyMarks(
        new Uint32Array(mapped, 0, bytes / 4),
        tag.bases,
        cascades,
        pool,
        tag.frame,
      )
      stats.reads++
      pool.expire(tag.frame)
    },
  )
  const take = (frame: number) => {
    const tag = tags[next]
    const buffer = ring.take(tag, bytes)
    if (!buffer) return undefined
    next = (next + 1) % tags.length
    tag.frame = frame
    for (let level = 0; level < levels; level++)
      for (let axis = 0; axis < 3; axis++)
        tag.bases[level * 3 + axis] = cascades.levels[level].base[axis]
    return buffer
  }
  return { ring, take }
}

/** The mark pass's group: the resources that stay (`fixed`: the levels' uniform, the atlas, the bitmap) and
 *  the image's depth, normals and view, made again only when one of them moved. */
function createMarkBinder(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  fixed: Record<'grid' | 'probes' | 'marks', GPUBindingResource>,
) {
  const bound = createWebgpuBindIdentity()
  let group: GPUBindGroup | undefined
  return (surface: MarkSurface) => {
    bound.next[0] = surface.depth
    bound.next[1] = surface.normals
    bound.next[2] = surface.view
    if (bound.moved())
      group = device.createBindGroup({
        layout,
        entries: namedEntries(MARK_BINDINGS, {
          ...fixed,
          view: { buffer: surface.view! },
          depth: surface.depth!,
          normals: surface.normals!,
        }),
      })
    return group!
  }
}

/** Whether a surface's signature or size differs from the last one watched of its view, which it then becomes. */
function createViewWatch() {
  type Seen = { signature: Float64Array; width: number; height: number }
  const views = new WeakMap<object, Seen>()
  const made = (): Seen => ({ signature: new Float64Array(MARK_SIGNATURE), width: 0, height: 0 })
  const alone = made()
  return (surface: MarkSurface) => {
    let seen = surface.key ? views.get(surface.key) : alone
    if (!seen) {
      seen = made()
      views.set(surface.key!, seen)
    }
    let differs = seen.width !== surface.size[0] || seen.height !== surface.size[1]
    seen.width = surface.size[0]
    seen.height = surface.size[1]
    for (let at = 0; at < MARK_SIGNATURE; at++) {
      if (seen.signature[at] !== surface.signature[at]) differs = true
      seen.signature[at] = surface.signature[at]
    }
    return differs
  }
}

/** The marks an image owes (`markJitter` after a change of view or of what it draws, of the levels or of
 *  the placements, one a mark issued), and whether this image's are due. */
function createMarkDebt() {
  const watch = createViewWatch()
  let owed = 0,
    changed = false
  return {
    get owed() {
      return owed
    },
    stale: () => void (changed = true),
    paid: () => void owed--,
    due(surface: MarkSurface | undefined, slid: boolean) {
      if (!surface?.depth || !surface.normals || !surface.view) owed = 0
      else if (watch(surface) || slid || changed) owed = BOUNCE_SETTINGS.markJitter
      changed = false
      return owed > 0
    },
  }
}

/** The marking dispatched over an image of `size` pixels: a group a tile of `markTilePixels` pixels a side. */
function markTiles(pass: GPUComputePassEncoder, size: readonly number[]) {
  const tile = BOUNCE_SETTINGS.markTilePixels * MARK_GROUP
  pass.dispatchWorkgroups(ceilDiv(size[0], tile), ceilDiv(size[1], tile), 1)
}

/** The bitmap the pass sets bits in (`bytes`), the ring it comes back through — which counts what came back
 *  in `stats` — and the compiled pass: released together, whole, when one of them is refused. */
async function createMarkParts(device: GPUDevice, cascades: BounceCascades, pool: ProbePool) {
  const bytes = markWords(cascades) * 4
  const stats: MarkStats = { reads: 0, cells: 0 }
  const bitmap = device.createBuffer({
    label: 'Trillion3D bounce marks v1',
    size: bytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  })
  const { ring, take } = createMarkRing(device, cascades, pool, bytes, stats)
  try {
    return { bytes, stats, bitmap, ring, take, program: await compileMarks(device) }
  } catch (error) {
    ring.destroy()
    bitmap.destroy()
    throw error
  }
}

/**
 * THE MARKS OF THE IMAGE, read back a few images late: the mark pass (`BOUNCE_MARK_SHADER`) sets a bit
 * for each cell of the levels the image reads, the bitmap is copied to a staging buffer of the engine's
 * one ring, and a few images later the pool gives each of those cells a probe (`createMarkRing`). No
 * image waits for them: one whose buffers are all in flight marks nothing and marks again the next.
 *
 * A change of view, or of what the view draws — the cut refining while the view stands still, pages
 * arriving —, owes `markJitter` marks — each takes another point of every tile, so that a cell a
 * tile's first point missed is found by the next —; a level that slid or a placement that moved owes
 * as many. An image with nothing owed marks nothing: a still view, once marked, costs
 * nothing.
 */
export async function createBounceMarks(
  device: GPUDevice,
  cascades: BounceCascades,
  pool: ProbePool,
  grid: GPUBuffer,
  probes: GPUTextureView,
) {
  const { bytes, stats, bitmap, ring, take, program } = await createMarkParts(
    device,
    cascades,
    pool,
  )
  const debt = createMarkDebt()
  const groupFor = createMarkBinder(device, program.layout, {
    grid: { buffer: grid },
    probes,
    marks: { buffer: bitmap },
  })
  let staging: GPUBuffer | undefined
  return {
    /** The marks that came back: how many, and the cells the last one named. */
    stats,
    /** Marks owed, and marks in flight: the series is not closed while there are any. */
    get pending() {
      return debt.owed > 0 || ring.held() > 0
    },
    /** The placements changed: the cells the image reads are marked again, from the next image that draws. */
    stale: debt.stale,
    /**
     * Whether image `frame` marks: its view differs from the last mark's, its levels `slid`, the placements
     * changed or marks are owed, and a buffer of the ring is free to bring them back. An image that
     * drew no surface (`surface` none) owes none.
     */
    begin(surface: MarkSurface | undefined, frame: number, slid: boolean) {
      if (!debt.due(surface, slid)) return false
      staging = take(frame)
      if (staging) debt.paid()
      return !!staging
    },
    /** The bitmap cleared, before the pass that marks. */
    clear: (encoder: GPUCommandEncoder) => encoder.clearBuffer(bitmap),
    /** The marking, in the bounce pass. */
    dispatch(pass: GPUComputePassEncoder, surface: MarkSurface) {
      pass.setPipeline(program.pipeline)
      pass.setBindGroup(0, groupFor(surface))
      markTiles(pass, surface.size)
    },
    /** The bitmap copied to the staging buffer `begin` took, after the pass. */
    copy(encoder: GPUCommandEncoder) {
      if (staging) encoder.copyBufferToBuffer(bitmap, 0, staging, 0, bytes)
    },
    /** After the image's submit: its copy maps. */
    submitted: () => ring.submitted(),
    dispose() {
      ring.destroy()
      bitmap.destroy()
    },
  }
}
