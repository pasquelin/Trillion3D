import type { RayTracing } from '../../../../../sdk-core/src/lighting/rayTracingFile.ts'
import { packDoubles } from '../../../../../math/src/float/splitDouble.ts'
import { DEG2RAD, NO_INDEX } from '../../../../../math/src/constants.ts'
import { nextPow2 } from '../../../../../math/src/scalar/integers.ts'
import { ensureSet, type HeldSet } from '../../../gpu/core/heldTextures.ts'
import type { ResourceAllocator } from '../../../gpu/core/resourceAllocator.ts'
import { SCENE_TRACE_PARAMS } from './sceneTraceWgsl.ts'

/** The scene trace's label: its buffers. */
const SCENE_TRACE_LABEL = 'Trillion3D scene trace'

/** The scene trace's defaults, the settings of `SceneTraceView` left out: how far from the eye an
 *  instance is traced, in metres, and the angle in degrees under which an instance is left out. */
const SCENE_TRACE_DEFAULTS = {
  cullRadius: 300,
  cullAngle: 1,
} as const

/** What a trace is cast from and how far it reaches this frame: the eye the rays and the cut's
 *  worlds are taken to, three doubles; the cut's tree top (`CutTables.treeRoot`); the triangles a
 *  trace may meet before it stops, incomplete, with the hit it holds; the distances in metres under
 *  which a ray that skips near hits passes a back face, and a two-sided hit, by; and the settings of
 *  `SCENE_TRACE_DEFAULTS` it overrides. */
interface SceneTraceView extends Partial<Record<keyof typeof SCENE_TRACE_DEFAULTS, number>> {
  readonly eye: readonly [number, number, number]
  readonly treeRoot: number
  readonly maxIterations: number
  readonly skipBackFaceDistance: number
  readonly skipTwoSidedDistance: number
}

/** What the table from a placement to its record reads of a root of the cut: the primitive it
 *  places, the mesh and the primitive's number in it (`ClusterRoot`). */
interface TracedRoot {
  readonly mesh?: number
  readonly primitive?: number
}

/** The words of the scene trace's three storage buffers: the file's nodes and triangles, and the table — the file's
 *  records, then a word for each placement the table has room for. */
export interface SceneTraceWords {
  readonly nodes: number
  readonly triangles: number
  readonly table: number
}

/** The placements a table has room for when the cut lists `placements`: a power of two, so that a scene that gains
 *  placements one by one does not make the resources again at each. */
const placementCapacity = (placements: number) => nextPow2(Math.max(placements, 1))

/** The words of the buffers a scene trace of `file` holds for `placements` placements: what it is made at, and what the
 *  device must hold of each buffer. */
export const sceneTraceWords = (file: RayTracing, placements: number): SceneTraceWords => ({
  nodes: file.nodes.length,
  triangles: file.triangles.length,
  table: file.records.length + placementCapacity(placements),
})

/** The buffers of a scene trace of `words`, asked of `allocator`. */
function allocate(allocator: ResourceAllocator, words: SceneTraceWords) {
  return {
    nodes: allocator.buffer('nodes', words.nodes, 'storage'),
    triangles: allocator.buffer('triangles', words.triangles, 'storage'),
    table: allocator.buffer('table', words.table, 'storage'),
    params: allocator.buffer('parameters', SCENE_TRACE_PARAMS.words, 'uniform'),
  }
}

/** Writes `words` into `buffer` from its start, unless there are none. */
function upload(device: GPUDevice, buffer: GPUBuffer, words: Uint32Array) {
  if (words.length) device.queue.writeBuffer(buffer, 0, words as Uint32Array<ArrayBuffer>)
}

/** The table from a placement to its record, in `table` after the file's `file.records`, with room for `capacity`
 *  placements: `sync` brings it level with the cut's roots, `placements` is the count it was last written for. */
function placementTable(device: GPUDevice, file: RayTracing, table: GPUBuffer, capacity: number) {
  const { byPrimitive } = file,
    placementWord = file.records.length
  let synced = 0,
    scratch = new Uint32Array(0),
    lastRoots: readonly TracedRoot[] | undefined
  return {
    placementWord,
    get placements() {
      return synced
    },
    sync(roots: readonly TracedRoot[]) {
      // The cut's roots only ever grow by appending, each with its mesh and primitive fixed: the list and its length name the table.
      if (roots === lastRoots && roots.length === synced) return
      if (roots.length > capacity)
        throw new Error(
          `${SCENE_TRACE_LABEL}: ${roots.length} placements past the table's room for ${capacity}`,
        )
      lastRoots = roots
      synced = roots.length
      if (scratch.length < synced) scratch = new Uint32Array(synced)
      const record = scratch.subarray(0, synced).fill(NO_INDEX)
      roots.forEach((root, rank) => {
        const held =
          root.mesh === undefined || root.primitive === undefined
            ? undefined
            : byPrimitive.get(root.mesh)?.get(root.primitive)
        if (held !== undefined) record[rank] = held
      })
      device.queue.writeBuffer(table, placementWord * 4, record)
    },
  }
}

/** The writer of a trace's parameters into `params`: from a view, over `placements` placements whose table starts at
 *  `placementWord`; not again where they are the words last written. */
function paramsWriter(device: GPUDevice, params: GPUBuffer, placementWord: number) {
  const paramBytes = new ArrayBuffer(SCENE_TRACE_PARAMS.words * 4),
    words = new Uint32Array(paramBytes),
    floats = new Float32Array(paramBytes)
  let written: Uint32Array | undefined
  return (view: SceneTraceView, placements: number) => {
    const P = SCENE_TRACE_PARAMS.at,
      D = SCENE_TRACE_DEFAULTS
    packDoubles(words, P.eyeXY, view.eye)
    floats[P.cullRadius] = view.cullRadius ?? D.cullRadius
    floats[P.tanCullAngle2] = Math.tan((view.cullAngle ?? D.cullAngle) * DEG2RAD) ** 2
    words[P.maxIterations] = view.maxIterations
    words[P.treeRoot] = view.treeRoot
    words[P.placements] = placements
    words[P.placementWord] = placementWord
    floats[P.skipBackFaceDistance] = view.skipBackFaceDistance
    floats[P.skipTwoSidedDistance] = view.skipTwoSidedDistance
    if (written?.every((word, at) => word === words[at])) return
    written ??= new Uint32Array(words.length)
    written.set(words)
    device.queue.writeBuffer(params, 0, paramBytes)
  }
}

/**
 * THE SCENE TRACE'S RESOURCES ON ONE DEVICE (`sceneTraceWgsl.ts` reads them), asked of the device's budget as the
 * lighting's are (`ensureSceneTrace`): the file's nodes and triangles, uploaded once, and a table buffer — the file's
 * records, then the table from a placement to its record — which `syncPlacements` rewrites when the placements change.
 * Three storage buffers and one uniform, whatever the scene's size. Past the upload the resources keep the table of the
 * file's primitives and the file by identity, not its words.
 *
 * A placement is named by its rank in the cut's tables — the rank of its root in
 * `layout.selectionRoots`, which the frame words, the worlds and the placement tree's members use —,
 * and its primitive by the root's mesh and its number in the mesh (`ClusterRoot.mesh`,
 * `ClusterRoot.primitive`), the two numbers the file's records are named by. A root that places no
 * primitive of the file — the world DAG's, one of another model, a primitive that built no
 * structure — has the record `NO_INDEX`, and the trace passes it by.
 */
function makeSceneTrace(
  device: GPUDevice,
  file: RayTracing,
  buffers: ReturnType<typeof allocate>,
  capacity: number,
) {
  const { nodes, triangles, table, params } = buffers
  upload(device, nodes, file.nodes)
  upload(device, triangles, file.triangles)
  upload(device, table, file.records)
  const placed = placementTable(device, file, table, capacity),
    write = paramsWriter(device, params, placed.placementWord)
  return {
    /** The placements the table has room for. */
    capacity,
    /**
     * Brings the table level with `roots` — the cut's, in the order of its tables, at most `capacity` —: written again
     * when the list or its length is not the one it was last written for.
     */
    syncPlacements: placed.sync,
    /** Writes the parameters of a trace from `view` (`SceneTraceView`), over the placements last
     *  synced: not again where they are the words last written. */
    writeParams(view: SceneTraceView) {
      write(view, placed.placements)
    },
  }
}

/** The scene trace: the buffers, the writers over them, and what the budget needs to hold and give it back. */
export type SceneTrace = ReturnType<typeof makeSceneTrace> & ReturnType<typeof allocate> & HeldSet

/**
 * The scene trace of `file` for `placements` placements: `held` where it is for that file and has room for as many — a
 * cut that shrinks keeps the room it had —, else made, `held` given back — where the device's budget leaves room (`ledgerAdmitted`); none where it does not, with the
 * reason.
 */
export function ensureSceneTrace(
  held: SceneTrace | undefined,
  device: GPUDevice,
  file: RayTracing,
  placements: number,
): { sceneTrace?: SceneTrace; why?: string } {
  const kept = held?.key[0] === file ? held.capacity : 0,
    capacity = Math.max(kept, placementCapacity(placements)),
    words = sceneTraceWords(file, capacity)
  const { resources, why } = ensureSet(
    held,
    device,
    { key: [file, capacity], what: 'the scene trace', label: SCENE_TRACE_LABEL },
    (allocator) => allocate(allocator, words),
    (buffers) => makeSceneTrace(device, file, buffers, capacity),
  )
  return { sceneTrace: resources, why }
}
