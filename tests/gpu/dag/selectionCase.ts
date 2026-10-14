// A DAG selection case laid out the way the engine's host uploads it: the buffers' contents and
// sizes the selection kernel binds (`selectionKernel.ts`), each derived from the engine's own
// layout functions, never restated.
import { WORKGROUP_THREADS } from '../../../packages/sdk-browser/src/gpu/dispatch/grid.ts'
import type * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { engineCamera } from '../../../packages/sdk-browser/src/camera/camera.fixture.ts'
import type { sceneRoots } from '../../../packages/sdk-browser/src/gpu/dag/cutFrontierScene.fixture.ts'
import { packedWorldsToRenderOrigin } from '../../../packages/sdk-browser/src/gpu/dag/pack.fixture.ts'
import { packDagSelection } from '../../../packages/sdk-browser/src/gpu/dag/pack.ts'
import { writeDagUniforms } from '../../../packages/sdk-browser/src/gpu/dag/uniforms.ts'
import { cameraSelectionUniforms } from '../../../packages/sdk-browser/src/gpu/core/selection.ts'
import type { SelectionUniforms } from '../../../packages/sdk-browser/src/gpu/core/selection.ts'
import { DAG_UNIFORM_BYTES } from '../../../packages/sdk-browser/src/gpu/dag/shader/viewsWgsl.ts'
import { primitiveFrameWords } from '../../../packages/sdk-browser/src/gpu/dag/worlds.ts'
import type { PackedDag } from '../../../packages/sdk-browser/src/gpu/dag/types.ts'
import { dagWorkLayout } from '../../../packages/sdk-browser/src/gpu/dag/shader/floorWgsl.ts'
import { dagGroupEntries } from '../../../packages/sdk-browser/src/gpu/dag/shader/bindings.ts'
import { createDagReadiness } from '../../../packages/sdk-browser/src/gpu/dag/readiness.ts'
import { heldOpenSlots } from '../../../packages/sdk-browser/src/gpu/dag/heldOpen.ts'
import { heldOpenAt } from '../../../packages/sdk-browser/src/gpu/dag/listCap.ts'
import { readoutRow } from '../../../packages/sdk-browser/src/gpu/dag/bufferTable.ts'
import { dagFlagShape } from '../../../packages/sdk-browser/src/gpu/dag/flagSections.ts'
import { createCutTables } from '../../../packages/sdk-browser/src/gpu/dag/cutTables.ts'
import { worldTableOn } from '../../../packages/sdk-browser/src/gpu/dag/worldTable.fixture.ts'
import { createTreeTable } from '../../../packages/sdk-browser/src/gpu/dag/treeTable.ts'
import { createRecordTexture } from '../../../packages/sdk-browser/src/gpu/core/recordTexture.ts'
import { FRAME_TABLE } from '../../../packages/sdk-browser/src/gpu/dag/frameTable.ts'
import {
  childBase,
  savedJournalWord,
  residentBase,
  selectionListCap,
} from '../../../packages/sdk-browser/src/gpu/dag/layout.ts'
import { ceilDiv } from '../../../packages/math/src/scalar/integers.ts'
import { setBit } from '../../../packages/math/src/scalar/bits.ts'
import { pageResidency } from '../../../packages/sdk-browser/src/gpu/dag/readiness.fixture.ts'
import { writeHostStretches } from '../../../packages/sdk-browser/src/gpu/dag/hostStretches.fixture.ts'

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

/** The cut rule's two residency bit sets over a copy of the cold words, and the open counts each
 *  placement holds kept in `packed.heldOpen`, as the engine's host uploads them
 *  (`gpu/dag/residencyUpload.ts`). */
function withResidency(packed: PackedDag, resident: ArrayLike<number>, slots: number) {
  const readiness = createDagReadiness(packed, slots)
  readiness.apply(pageResidency(resident))
  const { buffer, byteOffset, length } = packed.pageCones
  const cold = new Uint32Array(buffer, byteOffset, length).slice()
  const sets = [
    [readiness.isReady, residentBase(packed.pageCount)],
    [readiness.isChildReady, childBase(packed.pageCount)],
  ] as const
  for (const [ready, base] of sets) {
    const bits = cold.subarray(base)
    for (let page = 0; page < packed.pageCount; page++) if (ready(page)) setBit(bits, page)
  }
  return cold
}

/** What the kernel binds for `selectionCase`, each buffer under its WGSL name, with the sizes the
 *  engine gives the ones it writes. */
function caseBuffers({ packed, uniforms, resident, heldSlots = HELD_SLOTS }: SelectionCase) {
  // Before the frame words are read: readiness keeps the open counts each placement holds.
  const all = new Uint8Array(packed.pageCount).fill(1)
  const cold = withResidency(packed, resident ?? all, heldSlots)
  const listCap = selectionListCap(packed.pageCount)
  const views = new Float32Array(DAG_UNIFORM_BYTES / 4)
  // The open counts behind the readout's lists, as the engine lays them (`listCap.ts`).
  const held = { listCap, heldSlots, swap: { regions: 0 } }
  writeDagUniforms(views, packed, uniforms, listCap, undefined, undefined, heldOpenAt(held))
  const blockCount = ceilDiv(Math.max(1, packed.pageCount), WORKGROUP_THREADS),
    worldCount = Math.max(1, packed.worldCount)
  return {
    work: dagWorkLayout(blockCount),
    flagShape: dagFlagShape(packed),
    /** `out` with the staged requests behind the readout, for a list of `listCap` ranks, then the
     *  open counts the placements hold. */
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

/** Writes a case's output words before the kernel runs (requests staged by hand). */
export type StageOutput = (out: Uint32Array, at: ReturnType<typeof caseBuffers>) => void

/** `selection`'s buffers on `device` as the engine lays them out, and their bind group on
 *  `layout`; `stage`, when given, writes the output's words first. `destroy` frees them. */
export function bindCase(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  selection: SelectionCase,
  stage?: StageOutput,
) {
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
  stage?.(out, at)
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
      pageCones: new Float32Array(at.cold.buffer),
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
