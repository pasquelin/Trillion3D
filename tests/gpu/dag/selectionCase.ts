// A DAG selection case laid out the way the engine's host uploads it: the buffers' contents and
// sizes the selection kernel binds (`selectionKernel.ts`), each derived from the engine's own
// layout functions, never restated.
import type * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { engineCamera } from '../../../packages/sdk-browser/src/camera/camera.fixture.ts'
import type { sceneRoots } from '../../../packages/sdk-browser/src/gpu/dag/cutFrontierScene.fixture.ts'
import { packedWorldsToRenderOrigin } from '../../../packages/sdk-browser/src/gpu/dag/pack.fixture.ts'
import { packDagSelection } from '../../../packages/sdk-browser/src/gpu/dag/selection.ts'
import { writeDagUniforms } from '../../../packages/sdk-browser/src/gpu/dag/uniforms.ts'
import {
  SELECTION_WORKGROUP,
  cameraSelectionUniforms,
} from '../../../packages/sdk-browser/src/gpu/core/selection.ts'
import type { SelectionUniforms } from '../../../packages/sdk-browser/src/gpu/core/selection.ts'
import { DAG_UNIFORM_BYTES } from '../../../packages/sdk-browser/src/gpu/dag/shader/viewsWgsl.ts'
import { primitiveFrameWords } from '../../../packages/sdk-browser/src/gpu/dag/worlds.ts'
import { framesBytes } from '../../../packages/sdk-browser/src/gpu/dag/frameRanges.ts'
import type { PackedDag } from '../../../packages/sdk-browser/src/gpu/dag/types.ts'
import { dagWorkLayout } from '../../../packages/sdk-browser/src/gpu/dag/shader/floorWgsl.ts'
import { DAG_BINDING } from '../../../packages/sdk-browser/src/gpu/dag/shader/bindings.ts'
import { namedBufferEntries } from '../../../packages/sdk-browser/src/gpu/core/computeBindings.ts'
import { dagFlagsWords } from '../../../packages/sdk-browser/src/gpu/dag/shader/lastUseWgsl.ts'
import { createDagReadiness } from '../../../packages/sdk-browser/src/gpu/dag/readiness.ts'
import { worldBufferWords } from '../../../packages/sdk-browser/src/gpu/dag/worldBuffer.fixture.ts'
import {
  childBase,
  residentBase,
  selectionListCap,
  stagedOutputBytes,
} from '../../../packages/sdk-browser/src/gpu/dag/layout.ts'

/** One cut to run: a packed scene, the camera's uniforms and each page's residency, every page
 *  resident when none is given. */
export interface SelectionCase {
  name: string
  packed: PackedDag
  uniforms: SelectionUniforms
  resident?: ArrayLike<number>
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

/** The cut rule's two residency bit sets over a copy of the cold words, and each node's open
 *  count written into `packed`, as the engine's host uploads them (`gpu/dag/residencyUpload.ts`). */
function withResidency(packed: PackedDag, resident: ArrayLike<number>) {
  const readiness = createDagReadiness(packed)
  readiness.apply(resident)
  const { buffer, byteOffset, length } = packed.pageCones
  const cold = new Uint32Array(buffer, byteOffset, length).slice()
  const sets = [
    [readiness.isReady, residentBase(packed.pageCount)],
    [readiness.isChildReady, childBase(packed.pageCount)],
  ] as const
  for (const [ready, base] of sets)
    for (let page = 0; page < packed.pageCount; page++)
      if (ready(page)) cold[base + (page >>> 5)] |= 1 << (page & 31)
  return cold
}

/** What the kernel binds for `selectionCase`, each buffer under its WGSL name, with the sizes the
 *  engine gives the ones it writes. */
function caseBuffers({ packed, uniforms, resident }: SelectionCase) {
  // Before the node words are read: readiness writes each node's open count into them.
  const cold = withResidency(packed, resident ?? new Uint8Array(packed.pageCount).fill(1))
  const listCap = selectionListCap(packed.pageCount)
  const views = new Float32Array(DAG_UNIFORM_BYTES / 4)
  writeDagUniforms(views, packed, uniforms, listCap)
  const blockCount = Math.ceil(Math.max(1, packed.pageCount) / SELECTION_WORKGROUP),
    worldCount = Math.max(1, packed.worldCount)
  return {
    work: dagWorkLayout(blockCount),
    flagsWords: dagFlagsWords(packed.nodeCount, packed.pageCount),
    /** `out` with the staged requests behind the readout, for a list of `listCap` ranks. */
    outBytes: stagedOutputBytes(listCap),
    listCap,
    worldCount,
    clusters: packed.clusters,
    nodes: packed.nodes,
    worlds: worldBufferWords(packed.worlds, packed.worldSources),
    cold,
    /** The host's row per primitive, then what `dagPrepare` derives behind it. */
    frames: primitiveFrameWords(packed),
    framesBytes: framesBytes(worldCount),
    /** One range holds every primitive (`frameRanges.ts`): `{first, count}`. */
    range: new Uint32Array([0, worldCount, 0, 0]),
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
  const made: GPUBuffer[] = []
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  const buffer = (size: number, data?: ArrayBufferView, usage = storage) => {
    const created = device.createBuffer({ size: Math.max(16, size, data?.byteLength ?? 0), usage })
    if (data) device.queue.writeBuffer(created, 0, data.buffer, data.byteOffset, data.byteLength)
    made.push(created)
    return { buffer: created }
  }
  let out: Uint32Array | undefined
  if (stage) stage((out = new Uint32Array(at.outBytes / 4)), at)
  const uniform = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  const buffers = {
    clusters: buffer(64, at.clusters),
    nodes: buffer(64, at.nodes),
    views: buffer(256, at.views, uniform),
    flags: buffer(at.flagsWords * 4),
    out: buffer(at.outBytes, out),
    work: buffer(at.work.words * 4),
    worlds: buffer(64, at.worlds),
    frames: buffer(at.framesBytes, at.frames),
    cold: buffer(48, at.cold),
    range: buffer(16, at.range, uniform),
  }
  const group = device.createBindGroup({
    layout,
    entries: namedBufferEntries(DAG_BINDING, buffers),
  })
  return { at, buffers, group, destroy: () => made.forEach((created) => created.destroy()) }
}
