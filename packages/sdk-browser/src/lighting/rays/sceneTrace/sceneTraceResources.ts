import type { RayTracing } from '../../../../../sdk-core/src/lighting/rayTracingFile.ts'
import { packDoubles } from '../../../../../math/src/float/splitDouble.ts'
import { DEG2RAD, FLOAT32_MAX, NO_INDEX } from '../../../../../math/src/constants.ts'
import { ceilDiv, nextPow2 } from '../../../../../math/src/scalar/integers.ts'
import { isWorldRoot } from '../../distanceField/hlodObjects.ts'
import { ensureSet, type HeldSet } from '../../../gpu/core/heldTextures.ts'
import type { ResourceAllocator } from '../../../gpu/core/resourceAllocator.ts'
import type { GpuSelection } from '../../../gpu/core/selection.ts'
import type { DagReadTables } from '../../../geometry/dag/shader/bindings.ts'
import {
  TRACED_MATERIAL_AT,
  TRACED_MATERIAL_WORDS,
  tracedMaterialsOf,
  type TracedMask,
  type TracedSurface,
} from '../../reflections/translucency/materialWords.ts'
import { createCullGroups, encodeSceneCull } from './sceneCullPass.ts'
import type { MaskHold } from './sceneMaskHold.ts'
import { sceneMaskNone } from './sceneMaskNone.ts'
import type { SceneMaskResources } from './sceneMaskWgsl.ts'
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
  /** Whether the primitives of a sky material are left out of the rays that do not meet the sky (`ST_SKY`, `ST_MEET_SKY`). */
  readonly excludesSky: boolean
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

/** The words of the scene trace's two storage buffers, each of which must fit one binding (`maxStorageBufferBindingSize`, which `tracedRaysFit` checks before the trace is made: a scene whose buffers do not fit leaves its rays to the distance field): the geometry — the file's nodes, then its triangles, each part on a `vec4u`, in one buffer so that a pass binds the trace in few storage buffers (a stage holds eight) — and the table — the file's records, then what the file alone sizes: the attributes of the triangles' corners and the cutout coordinates of the corners of the masked primitives, which a hit
 *  reads word by word, and `TRACED_MATERIAL_WORDS` for each material the HLOD actors wear (`RayTracing.actorRanks`); then what the cut's growth resizes, so that it moves
 *  none of the former: a word for each placement the table has room for, the cells' words, a word for each placement again (whether the image's culling left it out,
 *  `SceneTrace.cullPlacements`), and last `TRACED_MATERIAL_WORDS` for each placement: its material. The corners weigh as much as the triangles do (48 bytes a triangle, 16 a corner), so the two buffers
 *  are about as large as each other, the nodes' share in the geometry. */
export interface SceneTraceWords {
  readonly geometry: number
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
  geometry: geometryBases(file).vectors * 4,
  table: tableAt(file, shape).end,
})

/** Where the parts of the table begin, in words, and where it ends: the file's records, the corners' attributes and their cutout coordinates, the HLOD actors' material words (what the file sizes), then the placements' records, the cells' words, the culling words and the placements' materials (what the shape sizes). */
function tableAt(file: RayTracing, shape: TableShape) {
  const cornerWord = file.records.length,
    maskWord = cornerWord + file.corners.length,
    actorWord = maskWord + file.maskCorners.length,
    placementWord = actorWord + TRACED_MATERIAL_WORDS * file.actorRanks,
    cellsWord = placementWord + shape.placements,
    cullWord = cellsWord + shape.instances * shape.cells,
    materialWord = cullWord + shape.placements
  return {
    cornerWord,
    maskWord,
    actorWord,
    placementWord,
    cellsWord,
    cullWord,
    materialWord,
    end: Math.max(materialWord + TRACED_MATERIAL_WORDS * shape.placements, 1),
  }
}

/** The buffers of a scene trace of `words`, asked of `allocator`. */
function allocate(allocator: ResourceAllocator, words: SceneTraceWords) {
  return {
    geometry: allocator.buffer('geometry', words.geometry, 'storage'),
    table: allocator.buffer('table', words.table, 'storage'),
    params: allocator.buffer('parameters', SCENE_TRACE_PARAMS.words, 'uniform'),
  }
}

/** Writes `words` into `buffer` from the word `at`, unless there are none. */
function upload(device: GPUDevice, buffer: GPUBuffer, at: number, words: Uint32Array) {
  if (words.length) device.queue.writeBuffer(buffer, at * 4, words as Uint32Array<ArrayBuffer>)
}

/** Where the triangles begin in the geometry buffer, in `vec4u` (the parameters' `triangleBase`), and how many `vec4u` it holds: the nodes begin it, five `vec4u` a node, then the triangles, three a triangle;
 *  the triangles begin on a `vec4u`, whatever the length of the nodes in words (a part that is not a whole number of them is padded with zeros). */
const geometryBases = (file: RayTracing) => {
  const triangles = ceilDiv(file.nodes.length, 4)
  return { triangles, vectors: Math.max(triangles + ceilDiv(file.triangles.length, 4), 1) }
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

/** The last revision of any scene trace's cutouts: a revision is never taken twice, whichever trace (one made again when its capacity grew) holds it. */
let cutoutEpoch = 0

/** The cutout words of a material (`TRACED_MATERIAL_AT`): the threshold, the base map's slot or graph record, and the bits. */
const CUTOUT_AT = [TRACED_MATERIAL_AT.cut, TRACED_MATERIAL_AT.map, TRACED_MATERIAL_AT.mask]

/** The cutout of a root's surface, with the `stamp` of what the cutouts depend on besides the surface itself (its version): while the surfaces and the stamp stand, the words made from them stand. A reader without a stamp is asked every time. */
export type TracedMaskReader<Root> = ((root: Root) => TracedMask | undefined) & {
  readonly stamp?: readonly unknown[]
}

const NO_STAMP: readonly unknown[] = []

/** The surface a root wears and the version it was made at, when it has one: what tells a surface changed (a surface without a version is never taken as unchanged). */
const surfaceOf = (root: TracedRoot) =>
  root.worn?.surface as (TracedSurface & { version?: number }) | undefined

/**
 * The writer of material words into `table` from the word `word`: made from the surfaces `roots` wear (a surface may change under the same roots) over `count` materials
 * (the words past `roots` are zero: no surface, no cutout), and written when they differ from the words last written. `cutoutChanged` is called when the cutouts alone changed
 * (a word of the entries written before, or an entry that cuts), what an accumulation over the traced image restarts at; a colour that moved, or entries that grew without a cutout, do not.
 * Where the surfaces the roots wear are the ones last written, each at its version, and the cutouts' stamp stands, the words are not made again nor compared.
 */
function materialsWriter(
  device: GPUDevice,
  table: GPUBuffer,
  word: number,
  cutoutChanged: () => void,
) {
  let materials = new Float32Array(0),
    written = new Float32Array(0),
    cutouts = new Uint32Array(0),
    seen:
      | {
          readonly surfaces: readonly unknown[]
          readonly versions: readonly (number | undefined)[]
          readonly count: number
          readonly stamp: readonly unknown[]
        }
      | undefined
  /** Whether the words last written were made from these surfaces at these versions, for this count and stamp. */
  const unchanged = (
    roots: readonly TracedRoot[],
    count: number,
    stamp: readonly unknown[],
  ): boolean =>
    !!seen &&
    seen.count === count &&
    seen.surfaces.length === roots.length &&
    seen.stamp.length === stamp.length &&
    stamp.every((part, n) => Object.is(part, seen!.stamp[n])) &&
    roots.every((root, rank) => {
      const surface = surfaceOf(root)
      return (
        surface === seen!.surfaces[rank] &&
        (surface === undefined ||
          (surface.version !== undefined && surface.version === seen!.versions[rank]))
      )
    })
  return {
    write<Root extends TracedRoot>(
      roots: readonly Root[],
      count: number,
      maskOf?: TracedMaskReader<Root>,
    ) {
      // A reader that names no stamp cannot be told unchanged.
      const stamp = maskOf ? maskOf.stamp : NO_STAMP
      if (stamp && unchanged(roots, count, stamp)) return
      seen = stamp && {
        surfaces: roots.map((root) => surfaceOf(root)),
        versions: roots.map((root) => surfaceOf(root)?.version),
        count,
        stamp: [...stamp],
      }
      if (materials.length !== count * TRACED_MATERIAL_WORDS)
        materials = new Float32Array(count * TRACED_MATERIAL_WORDS)
      else materials.fill(0)
      tracedMaterialsOf(roots.length > count ? roots.slice(0, count) : roots, materials, maskOf)
      if (
        written.length === materials.length &&
        written.every((w, at) => Object.is(w, materials[at]))
      )
        return
      written = materials.slice()
      const bits = new Uint32Array(materials.buffer)
      const next = new Uint32Array(count * CUTOUT_AT.length)
      for (let k = 0; k < count; k++)
        CUTOUT_AT.forEach(
          (at, n) => (next[k * CUTOUT_AT.length + n] = bits[k * TRACED_MATERIAL_WORDS + at]!),
        )
      // A word past the end of a list is zero, the cutout of an opaque entry.
      const span = Math.max(cutouts.length, next.length)
      for (let at = 0; at < span; at++)
        if ((cutouts[at] ?? 0) !== (next[at] ?? 0)) {
          cutoutChanged()
          break
        }
      cutouts = next
      device.queue.writeBuffer(table, word * 4, materials)
    },
  }
}

/** The table from a placement to its record, in `table` after what the file sizes, with room for `shape.placements`
 *  placements, then the cells' words: `sync` brings them level with the cut's roots and its world, `placements` is the count
 *  it was last written for. The material words of the placements and of the HLOD actors (`file.actorRanks`) are written with it. */
function placementTable(device: GPUDevice, file: RayTracing, table: GPUBuffer, shape: TableShape) {
  const { byPrimitive } = file,
    { placementWord, cellsWord, cullWord, materialWord, actorWord } = tableAt(file, shape)
  const writeCells = cellWordsWriter(device, table, cellsWord, shape)
  let revision = ++cutoutEpoch
  const bump = () => {
    revision = ++cutoutEpoch
  }
  const placementMaterials = materialsWriter(device, table, materialWord, bump),
    actorMaterials = materialsWriter(device, table, actorWord, bump)
  let synced = 0,
    scratch = new Uint32Array(0),
    lastRoots: readonly TracedRoot[] | undefined
  return {
    placementWord,
    cellsWord,
    cullWord,
    materialWord,
    /** The revision of the cutouts of the placements' and of the actors' materials: a number no other table has had, taken again when they change. */
    get revision() {
      return revision
    },
    get placements() {
      return synced
    },
    sync<Root extends TracedRoot, Actor extends TracedRoot = Root>(
      roots: readonly Root[],
      world?: TracedWorld,
      cacheRoots: readonly TracedRoot[] = roots,
      maskOf?: TracedMaskReader<Root | Actor>,
      actors: readonly Actor[] = [],
    ) {
      writeCells(world, roots, cacheRoots)
      if (roots.length <= shape.placements) placementMaterials.write(roots, roots.length, maskOf)
      if (file.actorRanks > 0) actorMaterials.write(actors, file.actorRanks, maskOf)
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
    readonly cornerWord: number
    readonly maskWord: number
    readonly actorWord: number
    readonly cells: number
  },
) {
  const paramBytes = new ArrayBuffer(SCENE_TRACE_PARAMS.words * 4),
    words = new Uint32Array(paramBytes),
    floats = new Float32Array(paramBytes)
  const bases = geometryBases(file)
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
    words[P.excludesSky] = view.excludesSky ? 1 : 0
    words[P.materialWord] = where.materialWord
    words[P.triangleBase] = bases.triangles
    words[P.cornerWord] = where.cornerWord
    words[P.maskWord] = where.maskWord
    words[P.actorWord] = where.actorWord
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
 * which `syncPlacements` rewrites when the placements or the cut's draws change. Two storage buffers (the geometry, the table) and one uniform,
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
  maskHold: MaskHold,
) {
  const { geometry, table, params } = buffers
  const bases = geometryBases(file),
    at = tableAt(file, shape)
  upload(device, geometry, 0, file.nodes)
  upload(device, geometry, bases.triangles * 4, file.triangles)
  upload(device, table, 0, file.records)
  upload(device, table, at.cornerWord, file.corners)
  upload(device, table, at.maskWord, file.maskCorners)
  const placed = placementTable(device, file, table, shape),
    write = paramsWriter(device, params, file, {
      placementWord: placed.placementWord,
      cellsWord: placed.cellsWord,
      cullWord: placed.cullWord,
      materialWord: placed.materialWord,
      cornerWord: at.cornerWord,
      maskWord: at.maskWord,
      actorWord: at.actorWord,
      cells: shape.cells,
    }),
    cullGroups = createCullGroups()
  let cullMode: number = SCENE_CULL_MODE.disabled
  return {
    /** The placements the table has room for. */
    capacity: shape.placements,
    /** The instances of the world DAG it has room for, and the cells each holds a word of. */
    shape,
    /** What the any-hit test reads beside the trace (`sceneMaskWgsl.ts`): the colour atlas and the sampler of the maps, named by the lighting each image
     *  (`sceneMaskNone` until it has, so that every pass can bind the trace). */
    maskReads: sceneMaskNone(device) as SceneMaskResources,
    /** The graph programs the passes cut by, and the passes whose kernels are ready for them (`sceneMaskHold.ts`): the runtime's, so that a trace made again (its table grew) keeps the held set, the candidates and the kernels. */
    maskHold,
    /**
     * Brings the table level with `roots` — the cut's, in the order of its tables, at most `capacity` —: written again
     * when the list or its length is not the one it was last written for; and its cells' words level with what the
     * cut's `world` draws; `maskOf` gives the cutout of each root's surface (`sceneMaskWords.ts`) the any-hit test reads, and `actors` the
     * HLOD actors as roots wearing their materials, by the rank their records name (`RayTracing.actorRanks` of them are read).
     */
    syncPlacements: placed.sync,
    /** The revision of the cutouts of the placements' and of the actors' materials (unique across traces), read as it stands (a method: the set the trace is held in copies what it is made of): what an accumulation over the traced image restarts at. */
    cutoutRevision: () => placed.revision,
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
 * leaves room (`ledgerAdmitted`); none where it does not, with the reason. The trace is made over `maskHold`, which its owner keeps from one trace to the next and drops itself (`MaskHold.dispose`): the trace never makes one.
 */
export function ensureSceneTrace(
  held: SceneTrace | undefined,
  device: GPUDevice,
  file: RayTracing,
  placements: number,
  world: TracedWorld | undefined,
  maskHold: MaskHold,
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
    (buffers) => makeSceneTrace(device, file, buffers, shape, maskHold),
  )
  return { sceneTrace: resources, why }
}
