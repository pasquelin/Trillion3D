import type { RayTracing } from '../../../../../sdk-core/src/lighting/rayTracingFile.ts'
import { packDoubles } from '../../../../../math/src/float/splitDouble.ts'
import { DEG2RAD, FLOAT32_MAX, NO_INDEX } from '../../../../../math/src/constants.ts'
import { nextPow2 } from '../../../../../math/src/scalar/integers.ts'
import { isWorldRoot } from '../../distanceField/hlodObjects.ts'
import { ensureSet, type HeldSet } from '../../../gpu/core/heldTextures.ts'
import type { ResourceAllocator } from '../../../gpu/core/resourceAllocator.ts'
import type { GpuSelection } from '../../../gpu/core/selection.ts'
import type { DagReadTables } from '../../../geometry/dag/shader/bindings.ts'
import {
  TRACED_MATERIAL_WORDS,
  tracedMaterialsOf,
  type TracedSurface,
} from '../../reflections/translucency/materialWords.ts'
import { createCullGroups, encodeSceneCull } from './sceneCullPass.ts'
import { SCENE_CULL_FLAGS, SCENE_CULL_MODE } from './sceneCullWgsl.ts'
import {
  SCENE_TRACE_CELL_DRAWN,
  SCENE_TRACE_PARAMS,
  SCENE_TRACE_WORLD_BIT,
} from './sceneTraceWgsl.ts'

/** The scene trace's label: its buffers. */
const SCENE_TRACE_LABEL = 'Trillion3D scene trace'

/** How the placements the rays can meet are chosen for an image (`sceneCullWgsl.ts`): the mode
 *  (`SCENE_CULL_MODE`, `rayTracingCulling`), the radius in metres and the angle in degrees an object is far and small by
 *  (`rayTracingCullingRadius`, `rayTracingCullingAngle`), whether the distance is taken to the objects' boxes
 *  (`rayTracingCullingUseDistanceToBox`) and whether their least draw distance culls
 *  (`rayTracingCullingUseMinDrawDistance`), the direction the view looks along, and the scale the draw distances of the
 *  instances of an instanced mesh are drawn at (`viewDistanceFactor`) and whether they are tested at all
 *  (`cutDrawDistanceCulling`), as the cut does. */
interface SceneTraceCulling {
  readonly mode: number
  readonly radius: number
  readonly angle: number
  readonly useDistanceToBox: boolean
  readonly useMinDrawDistance: boolean
  readonly direction: readonly [number, number, number]
  readonly viewDistanceScale: number
  readonly instanceDrawDistance: boolean
}

/** What a trace is cast from and how far it reaches this frame: the eye the rays and the cut's
 *  worlds are taken to, three doubles; the cut's tree top (`CutTables.treeRoot`); the triangles a
 *  trace may meet before it stops, incomplete, with the hit it holds; the distances in metres under
 *  which a ray that skips near hits passes a back face, and a two-sided hit, by; whether the translucent primitives of a mesh that has an opaque one are left out of the rays
 *  that ask it; and the culling of the placements. */
interface SceneTraceView {
  readonly eye: readonly [number, number, number]
  readonly treeRoot: number
  readonly maxIterations: number
  readonly skipBackFaceDistance: number
  readonly skipTwoSidedDistance: number
  /** Whether the primitives flagged translucent are left out of the rays that ask it (`ST_SKIP_TRANSLUCENT`), where their mesh has an
   *  opaque primitive; a mesh translucent whole is left out of every ray (`ST_ALL_TRANSLUCENT`). */
  readonly skipsTranslucentSections: boolean
  readonly culling: SceneTraceCulling
}

/** What the table from a placement to its record reads of a root: the primitive it places, the
 *  mesh and the primitive's number in it (`ClusterRoot`), or, for a placement of the world DAG, the
 *  table of its cells (`hlod`, `WorldHeld`); of a root that stands for an HLOD cell's actors
 *  (`hlodObjects.ts`), the instance of the world DAG and the cell (`field.mesh`) it stands for. */
interface TracedRoot {
  readonly mesh?: number
  readonly primitive?: number
  readonly hlod?: unknown
  readonly standsFor?: number
  readonly instance?: number
  readonly field?: { readonly mesh: number }
  /** The surface its placement wears: the material words (`TRACED_MATERIAL_WORDS`) are made of it. */
  readonly worn?: { readonly surface: TracedSurface }
}

/** What the trace reads of the cut's world DAG: which HLOD actors the cut draws this frame
 *  (`WorldCells.draws`), and how many cells and instances of the world it packs
 *  (`GpuSelection.cellStates`). */
export type TracedWorld = Pick<GpuSelection, 'world' | 'cellStates'>

/** How the table is laid out past the file's records: the placements it has room for, then a word for each of `cells`
 *  HLOD cells of each of `instances` instances of the world DAG (`cellWordsWriter`). */
interface TableShape {
  readonly placements: number
  readonly instances: number
  readonly cells: number
}

/** The words of the scene trace's storage buffers: the file's nodes and triangles, the attributes of the triangles' corners (at least a vec4, whether the file has them or not), and the table — the file's
 *  records, a word for each placement the table has room for, the cells' words, then a word for each placement again:
 *  whether the image's culling left it out (`SceneTrace.cullPlacements`), then `TRACED_MATERIAL_WORDS` for each placement: its material. */
export interface SceneTraceWords {
  readonly nodes: number
  readonly triangles: number
  readonly corners: number
  readonly table: number
}

/** The tangent of the culling angle, squared, the angle held under 89.99 degrees: the ratio of a sphere's radius to its distance
 *  under which an object is small. */
const culledTanAngleSq = (angle: number) => Math.tan(Math.min(89.99, angle) * DEG2RAD) ** 2

/** The placements a table has room for when the cut lists `placements`: a power of two, so that a scene that gains
 *  placements one by one does not make the resources again at each. */
const placementCapacity = (placements: number) => nextPow2(Math.max(placements, 1))

/** The table's shape for `placements` placements and the cut's `world`, no smaller than the `kept` one where the cells
 *  are the same: the world's instances only where the file holds the world's record (`RayTracing.world`). A cut that
 *  packs no world DAG this frame says nothing of its cells: the `kept` room stays, so that a frame without it does not
 *  make the resources again, twice. */
function shapeOf(
  file: RayTracing,
  placements: number,
  world: TracedWorld | undefined,
  kept?: TableShape,
): TableShape {
  const states = world?.world ? world.cellStates : undefined
  const [cells, instances] =
    file.world === undefined
      ? [0, 0]
      : states
        ? [states.cells, nextPow2(Math.max(states.instances, 1))]
        : [kept?.cells ?? 0, kept?.instances ?? 0]
  return {
    placements: Math.max(kept?.placements ?? 0, placementCapacity(placements)),
    cells,
    instances: kept?.cells === cells ? Math.max(kept.instances, instances) : instances,
  }
}

/** The words of the buffers a scene trace of `file` holds for `placements` placements and the cut's `world`: what it is
 *  made at, and what the device must hold of each buffer. */
export const sceneTraceWords = (
  file: RayTracing,
  placements: number,
  world?: TracedWorld,
): SceneTraceWords => tableWords(file, shapeOf(file, placements, world))

const tableWords = (file: RayTracing, shape: TableShape): SceneTraceWords => ({
  nodes: file.nodes.length,
  triangles: file.triangles.length,
  corners: Math.max(file.corners.length, 4),
  table:
    file.records.length +
    (2 + TRACED_MATERIAL_WORDS) * shape.placements +
    shape.instances * shape.cells,
})

/** The buffers of a scene trace of `words`, asked of `allocator`. */
function allocate(allocator: ResourceAllocator, words: SceneTraceWords) {
  return {
    nodes: allocator.buffer('nodes', words.nodes, 'storage'),
    triangles: allocator.buffer('triangles', words.triangles, 'storage'),
    corners: allocator.buffer('corners', words.corners, 'storage'),
    table: allocator.buffer('table', words.table, 'storage'),
    params: allocator.buffer('parameters', SCENE_TRACE_PARAMS.words, 'uniform'),
  }
}

/** Writes `words` into `buffer` from its start, unless there are none. */
function upload(device: GPUDevice, buffer: GPUBuffer, words: Uint32Array) {
  if (words.length) device.queue.writeBuffer(buffer, 0, words as Uint32Array<ArrayBuffer>)
}

/** The words of `table` from `at`, a word for each HLOD cell of each instance of the world DAG, `shape.cells` words an
 *  instance: `SCENE_TRACE_CELL_DRAWN` where the cut draws the cell's actor this frame (`WorldCells.draws`), and under it
 *  the object a hit on the actor is told by, plus one (`SCENE_TRACE_CELL_OBJECT_MASK`) — the rank, among the roots the
 *  surface cache follows, of the stand-in that places the cell's cards (`hlodObjects.ts`; they come after the cut's
 *  `roots`, and stand only while the actor is drawn), nothing for an actor with none. The call reads them off the cut
 *  only when what they are made of moved — the cut's draw words (`WorldCells.drawRevision`), its cells and instances, the
 *  roots and the stand-ins' list — and writes them when they differ from the words last written. */
function cellWordsWriter(device: GPUDevice, table: GPUBuffer, at: number, shape: TableShape) {
  const words = new Uint32Array(shape.instances * shape.cells),
    written = new Uint32Array(words.length)
  const seen: unknown[] = [],
    next: unknown[] = []
  return (
    world: TracedWorld | undefined,
    roots: readonly unknown[],
    cacheRoots: readonly TracedRoot[],
  ) => {
    const cut = world?.world,
      states = world?.cellStates
    if (!words.length || !cut || !states) return
    // The stand-ins' list is another list whenever the cut's draws change (`createHlodObjects`), and only grows by
    // appending otherwise: its identity and length name it.
    next[0] = cut
    next[1] = cut.drawRevision
    next[2] = cacheRoots
    next[3] = cacheRoots.length
    next[4] = roots.length
    next[5] = states.cells
    next[6] = states.instances
    if (remember(seen, next)) return
    words.fill(0)
    const cells = Math.min(states.cells, shape.cells)
    const instances = Math.min(states.instances, shape.instances)
    for (let k = 0; k < instances; k++)
      for (let cell = 0; cell < cells; cell++)
        if (cut.draws(k, cell)) words[k * shape.cells + cell] = SCENE_TRACE_CELL_DRAWN
    markStandIns(words, cacheRoots, roots.length, shape.cells, instances, cells)
    // A fresh buffer is zero, as `written` begins.
    if (words.every((word, rank) => word === written[rank])) return
    written.set(words)
    device.queue.writeBuffer(table, at * 4, words)
  }
}

/** Whether `next` holds what `seen` does, the words of `seen` then the words of `next`. */
function remember(seen: unknown[], next: readonly unknown[]) {
  let same = true
  for (let k = 0; k < next.length; k++)
    if (seen[k] !== next[k]) {
      same = false
      seen[k] = next[k]
    }
  return same
}

/** The cells' words of the actors the cut draws, told by the rank of their stand-in: the stand-ins are the roots from `first` on, each with the
 *  instance and the cell it stands for, left out where the table holds no word for it or the actor is not drawn. */
function markStandIns(
  words: Uint32Array,
  cacheRoots: readonly TracedRoot[],
  first: number,
  cellsPerInstance: number,
  instances: number,
  cells: number,
) {
  for (let rank = first; rank < cacheRoots.length; rank++) {
    const { standsFor, instance, field } = cacheRoots[rank]
    if (standsFor === undefined || instance === undefined || !field) continue
    const word = instance * cellsPerInstance + field.mesh
    if (instance < instances && field.mesh < cells && words[word] !== 0)
      words[word] = SCENE_TRACE_CELL_DRAWN | (rank + 1)
  }
}

/** The table from a placement to its record, in `table` after the file's `file.records`, with room for `shape.placements`
 *  placements, then the cells' words: `sync` brings them level with the cut's roots and its world, `placements` is the count
 *  it was last written for. */
function placementTable(device: GPUDevice, file: RayTracing, table: GPUBuffer, shape: TableShape) {
  const { byPrimitive } = file,
    placementWord = file.records.length,
    cellsWord = placementWord + shape.placements,
    cullWord = cellsWord + shape.instances * shape.cells,
    materialWord = cullWord + shape.placements
  const writeCells = cellWordsWriter(device, table, cellsWord, shape)
  // The materials are made again each call (a surface may change under the same roots) and written when they differ from the words last written.
  let materials = new Float32Array(0),
    writtenMaterials = new Float32Array(0)
  const writeMaterials = (roots: readonly TracedRoot[]) => {
    if (roots.length > shape.placements) return
    if (materials.length !== roots.length * TRACED_MATERIAL_WORDS)
      materials = new Float32Array(roots.length * TRACED_MATERIAL_WORDS)
    tracedMaterialsOf(roots, materials)
    if (
      writtenMaterials.length === materials.length &&
      writtenMaterials.every((word, at) => Object.is(word, materials[at]))
    )
      return
    writtenMaterials = materials.slice()
    device.queue.writeBuffer(table, materialWord * 4, materials)
  }
  let synced = 0,
    scratch = new Uint32Array(0),
    lastRoots: readonly TracedRoot[] | undefined
  return {
    placementWord,
    cellsWord,
    cullWord,
    materialWord,
    get placements() {
      return synced
    },
    sync(
      roots: readonly TracedRoot[],
      world?: TracedWorld,
      cacheRoots: readonly TracedRoot[] = roots,
    ) {
      writeCells(world, roots, cacheRoots)
      writeMaterials(roots)
      // The cut's roots only ever grow by appending, each with its mesh and primitive fixed: the list and its length name the table.
      if (roots === lastRoots && roots.length === synced) return
      if (roots.length > shape.placements)
        throw new Error(
          `${SCENE_TRACE_LABEL}: ${roots.length} placements past the table's room for ${shape.placements}`,
        )
      lastRoots = roots
      synced = roots.length
      if (scratch.length < synced) scratch = new Uint32Array(synced)
      const record = scratch.subarray(0, synced).fill(NO_INDEX)
      // A placement of the world DAG is the world's record by its bit, its instance — the world DAG's placements in the
      // cut's order — under it; one the table has no room for in its cells' words is left out.
      let instance = 0
      roots.forEach((root, rank) => {
        if (isWorldRoot(root)) {
          if (file.world !== undefined && instance < shape.instances)
            record[rank] = (SCENE_TRACE_WORLD_BIT | instance) >>> 0
          instance++
          return
        }
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
 *  `placementWord`, the world's directory of `file`, the cells' words at `cellsWord` and the words of the culling at `cullWord`; not
 *  again where they are the words last written. */
function paramsWriter(
  device: GPUDevice,
  params: GPUBuffer,
  file: RayTracing,
  where: {
    readonly placementWord: number
    readonly cellsWord: number
    readonly cullWord: number
    readonly materialWord: number
    readonly cells: number
  },
) {
  const paramBytes = new ArrayBuffer(SCENE_TRACE_PARAMS.words * 4),
    words = new Uint32Array(paramBytes),
    floats = new Float32Array(paramBytes)
  let written: Uint32Array | undefined
  return (view: SceneTraceView, placements: number) => {
    const P = SCENE_TRACE_PARAMS.at,
      { culling } = view
    packDoubles(words, P.eyeXY, view.eye)
    // The radius where the screen's far trace begins is the culling's, the largest number with no culling.
    floats[P.cullRadius] = culling.mode === SCENE_CULL_MODE.disabled ? FLOAT32_MAX : culling.radius
    floats[P.culledTanAngleSq] = culledTanAngleSq(culling.angle)
    words[P.maxIterations] = view.maxIterations
    words[P.treeRoot] = view.treeRoot
    words[P.placements] = placements
    words[P.placementWord] = where.placementWord
    words[P.worldRecord] = file.world ?? NO_INDEX
    words[P.cellsWord] = where.cellsWord
    words[P.cells] = where.cells
    floats[P.skipBackFaceDistance] = view.skipBackFaceDistance
    floats[P.skipTwoSidedDistance] = view.skipTwoSidedDistance
    words[P.cullWord] = where.cullWord
    words[P.cullMode] = culling.mode
    words[P.cullFlags] =
      (culling.useDistanceToBox ? SCENE_CULL_FLAGS.distanceToBox : 0) |
      (culling.useMinDrawDistance ? SCENE_CULL_FLAGS.minDrawDistance : 0) |
      (culling.instanceDrawDistance ? SCENE_CULL_FLAGS.instanceDrawDistance : 0)
    floats.set(culling.direction, P.viewDirection)
    floats[P.viewDistanceScale] = culling.viewDistanceScale
    words[P.skipsTranslucentSections] = view.skipsTranslucentSections ? 1 : 0
    words[P.materialWord] = where.materialWord
    if (written?.every((word, at) => word === words[at])) return
    written ??= new Uint32Array(words.length)
    written.set(words)
    device.queue.writeBuffer(params, 0, paramBytes)
  }
}

/**
 * THE SCENE TRACE'S RESOURCES ON ONE DEVICE (`sceneTraceWgsl.ts` reads them), asked of the device's budget as the
 * lighting's are (`ensureSceneTrace`): the file's nodes, triangles and corners' attributes, uploaded once, and a table buffer — the file's
 * records, then the table from a placement to its record, then a word for each HLOD cell: whether the cut draws its actor, and the object a hit on it is told by,
 * then a word for each placement that the image's culling writes (`cullPlacements`) —
 * which `syncPlacements` rewrites when the placements or the cut's draws change. Four storage buffers and one uniform,
 * whatever the scene's size. Past the upload the resources keep the table of the file's primitives and the file by
 * identity, not its words.
 *
 * A placement is named by its rank in the cut's tables — the rank of its root in
 * `layout.selectionRoots`, which the frame words, the worlds and the placement tree's members use —,
 * and its primitive by the root's mesh and its number in the mesh (`ClusterRoot.mesh`,
 * `ClusterRoot.primitive`), the two numbers the file's records are named by. A root that places no
 * primitive of the file — one of another model, a primitive that built no structure — has the record `NO_INDEX`, and
 * the trace passes it by. A placement of the world DAG (`hlod`) is the file's directory of the HLOD actors
 * (`RayTracing.world`) at its instance: the trace enters the actors whose cell the cut draws as its actor
 * (`WorldCells.draws`, read each time the table is synced), the placements of a cell the cut draws as its placements
 * being roots of their own. */
function makeSceneTrace(
  device: GPUDevice,
  file: RayTracing,
  buffers: ReturnType<typeof allocate>,
  shape: TableShape,
) {
  const { nodes, triangles, corners, table, params } = buffers
  upload(device, nodes, file.nodes)
  upload(device, triangles, file.triangles)
  upload(device, corners, file.corners)
  upload(device, table, file.records)
  const placed = placementTable(device, file, table, shape),
    write = paramsWriter(device, params, file, {
      placementWord: placed.placementWord,
      cellsWord: placed.cellsWord,
      cullWord: placed.cullWord,
      materialWord: placed.materialWord,
      cells: shape.cells,
    }),
    cullGroups = createCullGroups()
  let cullMode: number = SCENE_CULL_MODE.disabled
  return {
    /** The placements the table has room for. */
    capacity: shape.placements,
    /** The instances of the world DAG it has room for, and the cells each holds a word of. */
    shape,
    /**
     * Brings the table level with `roots` — the cut's, in the order of its tables, at most `capacity` —: written again
     * when the list or its length is not the one it was last written for; and its cells' words level with what the
     * cut's `world` draws.
     */
    syncPlacements: placed.sync,
    /** Writes the parameters of a trace from `view` (`SceneTraceView`), over the placements last
     *  synced: not again where they are the words last written. */
    writeParams(view: SceneTraceView) {
      cullMode = view.culling.mode
      write(view, placed.placements)
    },
    /**
     * Chooses on `encoder` the placements the rays of the image can meet (`sceneCullWgsl.ts`), over the cut's tables `views`
     * and the parameters last written (`writeParams`): the words of the table the trace reads are written, once an image,
     * before any ray is cast. Until the kernel is compiled none is left out. With no culling the words an earlier mode wrote are
     * cleared once. Whether the words were written.
     */
    cullPlacements(encoder: GPUCommandEncoder, views: DagReadTables) {
      return encodeSceneCull(
        device,
        encoder,
        cullGroups,
        { params, table, views },
        placed.placements,
        cullMode,
        placed.cullWord,
      )
    },
  }
}

/** The scene trace: the buffers, the writers over them, and what the budget needs to hold and give it back. */
export type SceneTrace = ReturnType<typeof makeSceneTrace> & ReturnType<typeof allocate> & HeldSet

/**
 * The scene trace of `file` for `placements` placements and the cut's `world`: `held` where it is for that file and has
 * room for as many — a cut that shrinks keeps the room it had —, else made, `held` given back — where the device's budget
 * leaves room (`ledgerAdmitted`); none where it does not, with the reason.
 */
export function ensureSceneTrace(
  held: SceneTrace | undefined,
  device: GPUDevice,
  file: RayTracing,
  placements: number,
  world?: TracedWorld,
): { sceneTrace?: SceneTrace; why?: string } {
  const shape = shapeOf(file, placements, world, held?.key[0] === file ? held.shape : undefined),
    words = tableWords(file, shape)
  // An actor's cell word is read at its cell in an instance's row of `shape.cells` words, unchecked by the trace: a file
  // whose actors name a cell the cut does not pack is refused, the trace held given back.
  if (shape.instances > 0 && file.actorCells > shape.cells) {
    held?.dispose()
    return {
      why: `the scene trace's actors name ${file.actorCells} cells, the cut packs ${shape.cells}`,
    }
  }
  const { resources, why } = ensureSet(
    held,
    device,
    {
      key: [file, shape.placements, shape.instances, shape.cells],
      what: 'the scene trace',
      label: SCENE_TRACE_LABEL,
    },
    (allocator) => allocate(allocator, words),
    (buffers) => makeSceneTrace(device, file, buffers, shape),
  )
  return { sceneTrace: resources, why }
}
