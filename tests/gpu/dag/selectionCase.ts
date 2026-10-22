// A DAG selection case laid out the way the engine's host uploads it: the buffers' contents and
// sizes the selection kernel binds (`selectionKernel.ts`), each derived from the engine's own
// layout functions, never restated.
import { WORKGROUP_THREADS } from '../../../packages/sdk-browser/src/gpu/dispatch/grid.ts'
import type * as G from '../../../packages/sdk-browser/src/scene/host/graph/graph.fixture.ts'
import { engineCamera } from '../../../packages/sdk-browser/src/camera/camera.fixture.ts'
import type { sceneRoots } from '../../../packages/sdk-browser/src/geometry/dag/cut/cutFrontierScene.fixture.ts'
import { packedWorldsToRenderOrigin } from '../../../packages/sdk-browser/src/geometry/dag/pack/pack.fixture.ts'
import { packDagSelection } from '../../../packages/sdk-browser/src/geometry/dag/pack/pack.ts'
import { writeDagUniforms } from '../../../packages/sdk-browser/src/geometry/dag/uniforms.ts'
import { cameraSelectionUniforms } from '../../../packages/sdk-browser/src/gpu/core/selection.ts'
import type { SelectionUniforms } from '../../../packages/sdk-browser/src/gpu/core/selection.ts'
import { DAG_UNIFORM_BYTES } from '../../../packages/sdk-browser/src/geometry/dag/shader/viewsWgsl.ts'
import { primitiveFrameWords } from '../../../packages/sdk-browser/src/geometry/dag/worlds/worlds.ts'
import type { PackedDag } from '../../../packages/sdk-browser/src/geometry/dag/types.ts'
import { dagWorkLayout } from '../../../packages/sdk-browser/src/geometry/dag/shader/floorWgsl.ts'
import { dagGroupEntries } from '../../../packages/sdk-browser/src/geometry/dag/shader/bindings.ts'
import { createDagResidencyUpload } from '../../../packages/sdk-browser/src/geometry/dag/residencyUpload.ts'
import { heldOpenSlots } from '../../../packages/sdk-browser/src/geometry/dag/heldOpen.ts'
import { heldOpenAt } from '../../../packages/sdk-browser/src/geometry/dag/lists/listCap.ts'
import { readoutRow } from '../../../packages/sdk-browser/src/geometry/dag/bufferTable.ts'
import { dagFlagShape } from '../../../packages/sdk-browser/src/geometry/dag/flagSections.ts'
import { createCutTables } from '../../../packages/sdk-browser/src/geometry/dag/cut/cutTables.ts'
import { worldTableOn } from '../../../packages/sdk-browser/src/geometry/dag/worlds/worldTable.fixture.ts'
import { createTreeTable } from '../../../packages/sdk-browser/src/geometry/dag/tree/treeTable.ts'
import { createRecordTexture } from '../../../packages/sdk-browser/src/gpu/core/recordTexture.ts'
import { FRAME_TABLE } from '../../../packages/sdk-browser/src/geometry/dag/frameTable.ts'
import {
  savedJournalWord,
  selectionListCap,
} from '../../../packages/sdk-browser/src/geometry/dag/layout.ts'
import { ceilDiv } from '../../../packages/math/src/scalar/integers.ts'
import { DEFAULT_STREAMING_MIN_REQUESTS } from '../../../packages/sdk-core/src/contracts/streamingOptions.ts'
import { pageResidency } from '../../../packages/sdk-browser/src/geometry/dag/readiness.fixture.ts'
import { writeHostStretches } from '../../../packages/sdk-browser/src/geometry/dag/hostStretches.fixture.ts'

/** Slots of the open counts a case's placements hold: every count of the cases fits. */
const HELD_SLOTS = heldOpenSlots(1 << 16)

/** One cut to run: a packed scene, the camera's uniforms and each page's residency, every page
 *  resident when none is given. */
export interface SelectionCase {
  name: string
  packed: PackedDag
  uniforms: SelectionUniforms
  resident?: ArrayLike<number>
  /** Slots of the open counts its placements hold, every count fitting when none is given. */
  heldSlots?: number
}

/** `camera` looking at the scene's origin from (`x`, 0, `z`), and `roots` packed for it: the kernel
 *  works in the render frame, so the worlds are brought there, as the engine does. */
export function posedSelection(
  camera: ReturnType<typeof G.perspectiveCamera>,
  [x, z, threshold]: [number, number, number],
  viewport: [number, number],
  roots: ReturnType<typeof sceneRoots>,
) {
  camera.position.set(x, 0, z)
  camera.lookAt(x, 0, 0)
  camera.updateMatrixWorld(true)
  const uniforms = cameraSelectionUniforms(engineCamera(camera), threshold, viewport)
  const packed = packedWorldsToRenderOrigin(packDagSelection(roots), roots, uniforms.cameraWorld)
  return { packed, uniforms }
}

/** A device that takes the writes and keeps nothing: the host copy is what the kernel reads. */
const NO_DEVICE = { queue: { writeBuffer() {} } } as unknown as GPUDevice

/** The cold words as the engine's host uploads them for `resident` (`geometry/dag/residencyUpload.ts`):
 *  the cut rule's two residency bit sets and the world's stand-in flags, a copy, the open counts
 *  each placement holds kept in `packed.heldOpen`. */
function withResidency(packed: PackedDag, resident: ArrayLike<number>, slots: number) {
  const upload = createDagResidencyUpload({
    ...{ device: NO_DEVICE, packed, cold: () => {} },
    heldSlots: slots,
  })
  upload(pageResidency(resident))
  const { buffer, byteOffset, length } = packed.coldWords
  return new Uint32Array(buffer, byteOffset, length).slice()
}

/** What the kernel binds for `selectionCase`, each buffer under its WGSL name, with the sizes the
 *  engine gives the ones it writes. */
function caseBuffers({ packed, uniforms, resident, heldSlots = HELD_SLOTS }: SelectionCase) {
  // Before the frame words are read: readiness keeps the open counts each placement holds.
  const all = new Uint8Array(packed.pageCount).fill(1)
  const cold = withResidency(packed, resident ?? all, heldSlots)
  const listCap = selectionListCap(packed.pageCount, DEFAULT_STREAMING_MIN_REQUESTS)
  const views = new Float32Array(DAG_UNIFORM_BYTES / 4)
  // The open counts behind the readout's lists, as the engine lays them (`listCap.ts`).
  const held = { listCap, heldSlots, swap: { regions: 0 } }
  writeDagUniforms(views, packed, uniforms, listCap, undefined, heldOpenAt(held))
  const blockCount = ceilDiv(Math.max(1, packed.pageCount), WORKGROUP_THREADS),
    worldCount = Math.max(1, packed.worldCount)
  return {
    work: dagWorkLayout(blockCount),
    flagShape: dagFlagShape(packed),
    /** `out` as the engine sizes it for a list of `listCap` ranks, then the open counts the
     *  placements hold. */
    outBytes: readoutRow(listCap, 0, heldSlots).size,
    /** Where those counts lie in `out`, in bytes, and their words. */
    heldAt: savedJournalWord(listCap, 0) * 4,
    heldWords: packed.heldOpen!.words,
    listCap,
    worldCount,
    clusters: packed.clusters,
    nodes: packed.nodes,
    cold,
    /** The host's row per primitive (`frameTable.ts`). */
    frames: primitiveFrameWords(packed),
    views,
  }
}

/** `selection`'s buffers on `device` as the engine lays them out, and their bind group on
 *  `layout`. `destroy` frees them. */
export function bindCase(device: GPUDevice, layout: GPUBindGroupLayout, selection: SelectionCase) {
  const at = caseBuffers(selection)
  const made: { destroy(): void }[] = []
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  const buffer = (size: number, data?: ArrayBufferView, usage = storage) => {
    const created = device.createBuffer({ size: Math.max(16, size, data?.byteLength ?? 0), usage })
    if (data) device.queue.writeBuffer(created, 0, data.buffer, data.byteOffset, data.byteLength)
    made.push(created)
    return { buffer: created }
  }
  const out = new Uint32Array(at.outBytes / 4)
  out.set(at.heldWords, at.heldAt / 4)
  const uniform = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  const buffers = {
    views: buffer(256, at.views, uniform),
    out: buffer(at.outBytes, out),
    work: buffer(at.work.words * 4),
  }
  // The clusters, the nodes, the cold words and the flags, as the engine makes them
  // (`cutTables.ts`).
  const tables = createCutTables(
    device,
    {
      clusters: at.clusters,
      nodes: at.nodes,
      coldWords: new Float32Array(at.cold.buffer),
      pageCount: selection.packed.pageCount,
    },
    at.flagShape,
  )
  // The worlds' table, as the engine's host writes it (`worldTable.ts`).
  const worlds = worldTableOn(device, selection.packed.worlds, selection.packed.worldSources)
  // The placement tree's table, as the engine makes it (`treeTable.ts`).
  const tree = createTreeTable(device, selection.packed.placementTree)
  // The frame words' table, as the engine's host writes it (`cameraFrames.ts`).
  const read = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    frames = createRecordTexture(device, FRAME_TABLE, at.worldCount, read)
  frames.write('Row', 0, at.worldCount, at.frames.buffer, at.frames.byteOffset)
  // The stretches the session's root boxes pass writes, as no session runs here.
  writeHostStretches(frames, selection.packed.worldSources)
  made.push(worlds, tree, frames, ...Object.values(tables))
  const views = {
    worlds: worlds.view,
    // The poses the previous image drew: a case moves nothing, so they are the worlds.
    previous: worlds.view,
    frames: frames.view,
    tree: tree.view,
    clusters: tables.clusters.view,
    nodes: tables.nodes.view,
    cold: tables.cold.view,
    flags: tables.flags.view,
  }
  const group = device.createBindGroup({
    layout,
    entries: dagGroupEntries({
      views: buffers.views.buffer,
      out: buffers.out.buffer,
      work: buffers.work.buffer,
      ...views,
    }),
  })
  return { at, buffers, group, destroy: () => made.forEach((created) => created.destroy()) }
}
