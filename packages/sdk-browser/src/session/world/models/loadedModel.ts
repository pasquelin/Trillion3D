import { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts'
import { EngineError } from '../../../../../sdk-core/src/contracts/cache.ts'
import { Box3, boxFromFlat } from '../../../../../sdk-core/src/world/math/box3.ts'
import type { Light } from '../../../../../sdk-core/src/world/light/light.ts'
import type { Clip } from '../../../../../sdk-core/src/world/animation/clip.ts'
import { lightFromRecord } from '../../../../../sdk-core/src/world/light/lightRecord.ts'
import { loadImportedLights } from '../../../lighting/importedLights.ts'
import { plannedFiles } from './modelFiles.ts'
import type { ClusterManifest } from '../../../../../sdk-core/src/contracts/geometry.ts'
import type { AssetScope } from '../../../../../sdk-core/src/contracts/base.ts'
import type { JobProgress } from '../../../../../sdk-core/src/runtime/jobs/jobs.ts'
import { loadClusterManifest } from '../../../scene/manifestLoad.ts'
import { byteMeter, unmetered } from '../../../geometry/cluster/byteMeter.ts'
import { loadPreparedScene } from '../../../scene/drive/scene.ts'
import type { PageCache } from '../../../geometry/streaming/pageCache.ts'
import { createPageStreamer } from '../../../geometry/streaming/pageStreamer.ts'
import { emptyWorldBox, hostWorldBounds } from '../../../scene/host/world/bounds.ts'
import type { ExplorerScene } from '../../prepare.ts'
import type { SceneLight } from '../../../../../sdk-core/src/scene/light/contracts.ts'
import type { WorldRootsHold } from '../../../geometry/hlod/worldRoots.ts'
import { graphSubtree, modelNode } from './modelNodes.ts'
import { findNode } from '../../../scene/host/world/nameIndex.ts'

/** A model's scene as its record shows it: the graph its loader built, without the world roots it
 *  opened, which the model keeps to itself for its world's sessions. */
export type ModelScene = Omit<ExplorerScene, 'worldRoots'>

/** A compiled model as the world holds it: its manifest, and the graph its loader built. */
export type ModelRecord = {
  /** The address of the model's manifest, as the page gave it. */
  manifestUrl: string
  /** The address the manifest's details were read from. */
  metadataUrl: string
  /** The folder the model's other files are read against. */
  base: string
  /** The compiled manifest itself: primitives, pages and their sizes. */
  metadata: ClusterManifest
  /** The scene graph built from the cache's scene tables. */
  scene: ModelScene
}

/** The world roots `model`'s scene opened — its world's sessions draw from them and bind them to
 *  their queue (`../source.ts`) —, and their keeping by its load: friends of the class
 *  (`static`), so they stay out of its public members. */
export let modelWorldRoots: (model: LoadedModel) => readonly WorldRootsHold[]
let keepWorldRoots: (model: LoadedModel, roots: readonly WorldRootsHold[]) => void
/** The partitions `model` places its cells by: its record's for the model its manifest was read
 *  for, a placement of each for a model placed again (`placeModel`). */
export let modelPartitions: (model: LoadedModel) => ExplorerScene['partitions']
/** `model`'s rank among the placements of its record: 0 for the model its manifest was read for,
 *  `k` for its `k`-th placement since (`placeModel`) — its row in the record's sources and the
 *  instance of the world DAG it is drawn by (`models.ts`). */
export let placementIndex: (model: LoadedModel) => number
let keepLights: (model: LoadedModel, lights: readonly SceneLight[]) => void
/**
 * Another placement of the model `model`'s manifest was read for: a new model over the same record
 * — its manifest, graph, images and world roots, read once —, with its own world and visibility,
 * the lights its source file carried and a placement of each partition
 * (`PartitionCells.placement`), which places the cells its own view reaches. What `scene.load`
 * returns for a manifest the world already read (`../loader.ts`); the world draws every placement
 * of a record from the one set of pages, each placement a row of the same sources, cut at its own
 * distance (`models.ts`).
 */
export let placeModel: (model: LoadedModel) => LoadedModel

/**
 * A compiled model added to a scene like any other object: its pages stream by what the frame
 * reads, and its node poses it. A node of its source file is found by name (`getObjectByName`)
 * and moved like any node: it joins the model's children, under its ancestors, when first looked
 * up. `bounds` is the box it spans in its own frame.
 */
export class LoadedModel extends Object3D {
  /** Always `true`: tells a loaded model apart from any other object. */
  readonly isLoadedModel = true as const
  /** The box the model fills, in its own frame. */
  readonly bounds: Box3
  /** Lights under the model — those the source file carried, as nodes: a page edits, moves or
   *  removes them like its own, and they move with the model. */
  get lights(): Light[] {
    return this.children.filter((child) => (child as Light).isLight === true) as Light[]
  }
  /** The clips its source file plays, each track naming a node of the model: played by a mixer
   *  on the model (`animation.createMixer(model).clipAction(model.animations[0]).play()`). */
  get animations(): Clip[] {
    return this.record.scene.clips ?? []
  }
  /** Everything the world keeps about this model: its addresses, manifest and graph. */
  readonly record: ModelRecord
  /** The nodes its source file carried, told apart from those a page placed under it. */
  private readonly carried = new WeakSet<Object3D>()
  /** The world roots its scene opened (`modelWorldRoots`), kept by its load. */
  #worldRoots: readonly WorldRootsHold[] = []
  /** Its partitions' placements, for a model placed again (`modelPartitions`). */
  #partitions: ExplorerScene['partitions'] | undefined
  /** The model its record was read for, if it was placed from it (`placeModel`). */
  #first: LoadedModel | undefined
  /** The lights its source file carried, as read: each placement makes its own nodes of them. */
  #lights: readonly SceneLight[] = []
  /** How many times it was placed again (`placeModel`), and its own rank among those placements
   *  (`placementIndex`). */
  #placements = 0
  #index = 0
  static {
    modelWorldRoots = (model) => model.#worldRoots
    keepWorldRoots = (model, roots) => {
      model.#worldRoots = roots
    }
    modelPartitions = (model) => model.#partitions ?? model.record.scene.partitions
    placementIndex = (model) => model.#index
    keepLights = (model, lights) => {
      model.#lights = lights
      for (const record of lights) {
        const lamp = lightFromRecord(record)
        model._addFromFile(lamp, lamp.target)
      }
    }
    placeModel = (model) => {
      const first = model.#first ?? model,
        placed = new LoadedModel(first.record)
      placed.#first = first
      placed.#index = ++first.#placements
      placed.#worldRoots = first.#worldRoots
      placed.#partitions = first.record.scene.partitions.map((cells) => cells.placement())
      keepLights(placed, first.#lights)
      return placed
    }
  }
  /** Whether `node` came with the source file: a saved scene leaves it to the file. */
  _fromFile(node: Object3D) {
    return this.carried.has(node)
  }
  /** Adds nodes the source file carried (`loadModel`). */
  _addFromFile(...nodes: Object3D[]) {
    for (const node of nodes) this.carried.add(node)
    return this.add(...nodes)
  }
  /** The scene node standing for each graph node a page looked up, and for its ancestors. */
  private readonly looked = new Map<Object3D, Object3D>()
  /** The scene node of `graph`, built with its missing ancestors on first ask (`modelNode`). */
  private nodeOf(graph: Object3D): Object3D {
    let node = this.looked.get(graph)
    if (node) return node
    node = modelNode(graph)
    this.looked.set(graph, node)
    if (graph === this.record.scene.source || !graph.parent) this._addFromFile(node)
    else this.nodeOf(graph.parent).add(node)
    return node
  }
  /** The first node below with this name: the model, a node of its source file, then any other
   *  child — a light the file carried, a node a page placed. */
  override getObjectByName(name: string): Object3D | undefined {
    if (this.name === name) return this
    const graph = findNode(this.record.scene.source, name)
    return graph ? this.nodeOf(graph) : super.getObjectByName(name)
  }
  /** The scene node of source node `index` (`nodeOf`), the nodes below it and its radius
   *  (`graphSubtree`): what the physics moves a body's node by. `null` where the cache numbers
   *  its nodes otherwise than the source (a partitioned scene). */
  _nodeAt(index: number) {
    const nodes = this.record.scene.nodes
    if (!nodes?.[index]) return null
    return { node: this.nodeOf(nodes[index]), ...graphSubtree(nodes, index) }
  }
  constructor(record: ModelRecord) {
    super()
    this.record = record
    this.type = 'LoadedModel'
    const flat = hostWorldBounds(record.scene.source, emptyWorldBox())
    this.bounds = boxFromFlat(new Box3(), flat)
  }
  /** Refused: a model is loaded again with `scene.load`, never cloned. */
  protected override blank(): this {
    throw new EngineError('UNSUPPORTED_SCENE_UPDATE', 'A LoadedModel cannot be cloned')
  }
  /** The model's compiled manifest — its primitives, `sourceTriangles` — and `clusters`, the
   *  clusters its pages hold, every level of its DAGs counted. */
  get metadata() {
    const manifest = this.record.metadata
    const clusters = manifest.primitives.reduce((sum, { pages }) => sum + pages.length, 0)
    return { ...manifest, clusters }
  }
  override localBounds() {
    return this.bounds
  }
}

/**
 * Reads a compiled model — its manifest, then its source graph (`loadPreparedScene`) — for a world.
 * The images whose levels its cache baked whole are left unread: every session that draws the model
 * reads those levels from its cache (`materials/texture/textureCaches.ts`). `onProgress` hears `bytes`
 * against the files it reads (`plannedFiles`) as each chunk lands (`byteMeter`), the manifest read,
 * the scene tables read, then each resource the scene reads (`loadPreparedScene`).
 */
export async function loadModel(
  manifestUrl: string,
  options: {
    scope?: AssetScope
    signal?: AbortSignal
    onProgress?: (event: JobProgress) => void
    /** The world's page cache: the model's world roots are read through it, as every session's
     *  pages are. */
    pageCache: PageCache
  },
): Promise<LoadedModel> {
  const { signal, onProgress } = options
  const meter = onProgress
    ? byteMeter((completed, total) =>
        onProgress({ phase: 'bytes', completed, total, message: `${completed} of ${total} bytes` }),
      )
    : unmetered
  // A scope the page named is enforced; none named, the model is read at the one its pointer
  // declares (`loadClusterManifest`).
  const loaded = await loadClusterManifest(manifestUrl, options.scope, signal, meter)
  const { metadata, metadataUrl, base, declared } = loaded,
    scope = metadata.scope
  onProgress?.({ phase: 'manifest', completed: 1, total: 1, message: `Read ${metadataUrl}` })
  // The model reads its world roots through a queue of its own over the world's page cache, as a
  // session reads through its own: let go once the model is read.
  const queue = createPageStreamer([], base, { cache: options.pageCache, signal })
  const [scene, imported] = await Promise.all([
    loadPreparedScene(
      {
        manifestUrl,
        meter,
        queue,
        onTables: () => meter.plan(plannedFiles(declared, base)),
        onPreparation: (event) => onProgress?.({ ...event }),
      },
      metadata,
      base,
      scope,
      signal,
      () => {},
      () => {},
    ).then((read) => {
      // The framing buffer serves a session's first frame; a world frames with its own camera.
      read.framingLot?.release()
      return read
    }),
    loadImportedLights(base, signal, meter),
  ]).finally(() => queue.dispose())
  meter.settle()
  const { worldRoots, ...shown } = scene
  const model = new LoadedModel({
    manifestUrl,
    metadataUrl,
    base,
    metadata,
    scene: { ...shown, framingLot: null },
  })
  keepWorldRoots(model, worldRoots)
  keepLights(model, imported.lights)
  return model
}
