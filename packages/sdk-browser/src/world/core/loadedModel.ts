import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { EngineError } from '../../../../sdk-core/src/contracts/cache.ts';
import { Box3 } from '../../../../sdk-core/src/world/math/box3.ts';
import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts';
import type { Light } from '../../../../sdk-core/src/world/light/light.ts';
import type { Clip } from '../../../../sdk-core/src/world/animation/clip.ts';
import { lightFromRecord } from '../../../../sdk-core/src/world/light/lightRecord.ts';
import { loadImportedLights } from '../../lighting/importedLights.ts';
import { plannedFiles, SCENE_FILE } from './modelFiles.ts';
import type { ClusterManifest, AssetScope, JobProgress } from '../../../../sdk-core/src/index.ts';
import { loadClusterManifest } from '../../scene/manifestLoad.ts';
import { byteMeter, unmetered } from '../../cluster/byteMeter.ts';
import { loadPreparedScene } from '../scene/scene.ts';
import { emptyWorldBox, hostWorldBounds } from '../../host/world/bounds.ts';
import type { ExplorerScene } from '../session/prepare.ts';
import { findGraphNode, graphSubtree, modelNode } from './modelNodes.ts';

/** A compiled model as the world holds it: its manifest, and the graph its loader built. */
export type ModelRecord = {
  /** The address of the model's manifest, as the page gave it. */
  manifestUrl: string;
  /** The address the manifest's details were read from. */
  metadataUrl: string;
  /** The folder the model's other files are read against. */
  base: string;
  /** The compiled manifest itself: primitives, pages and their sizes. */
  metadata: ClusterManifest;
  /** The scene graph built from the cache's scene tables. */
  scene: ExplorerScene;
  /** Where its images were read: `cache` left the baked ones to the levels the session reads. */
  textureSource: 'host' | 'cache';
};

/**
 * A compiled model added to a scene like any other object: its pages stream by what the frame
 * reads, and its node poses it. A node of its source file is found by name (`getObjectByName`)
 * and moved like any node: it joins the model's children, under its ancestors, when first looked
 * up. `bounds` is the box it spans in its own frame.
 */
export class LoadedModel extends Object3D {
  /** Always `true`: tells a loaded model apart from any other object. */
  readonly isLoadedModel = true as const;
  /** The box the model fills, in its own frame. */
  readonly bounds: Box3;
  /** Lights under the model — those the source file carried, as nodes: a page edits, moves or
   *  removes them like its own, and they move with the model. */
  get lights(): Light[] {
    return this.children.filter((child) => (child as Light).isLight === true) as Light[];
  }

  /** The clips its source file plays, each track naming a node of the model: played by a mixer
   *  on the model (`animation.createMixer(model).clipAction(model.animations[0]).play()`). */
  get animations(): Clip[] {
    return this.record.scene.clips ?? [];
  }
  /** Everything the world keeps about this model: its addresses, manifest and graph. */
  readonly record: ModelRecord;
  /** The nodes its source file carried, told apart from those a page placed under it. */
  private readonly carried = new WeakSet<Object3D>();
  /** Whether `node` came with the source file: a saved scene leaves it to the file. */
  _fromFile(node: Object3D) {
    return this.carried.has(node);
  }
  /** Adds nodes the source file carried (`loadModel`). */
  _addFromFile(...nodes: Object3D[]) {
    for (const node of nodes) this.carried.add(node);
    return this.add(...nodes);
  }
  /** The scene node standing for each graph node a page looked up, and for its ancestors. */
  private readonly looked = new Map<Object3D, Object3D>();
  /** The scene node of `graph`, built with its missing ancestors on first ask (`modelNode`). */
  private nodeOf(graph: Object3D): Object3D {
    let node = this.looked.get(graph);
    if (node) return node;
    node = modelNode(graph);
    this.looked.set(graph, node);
    if (graph === this.record.scene.source || !graph.parent) this._addFromFile(node);
    else this.nodeOf(graph.parent).add(node);
    return node;
  }
  /** The first node below with this name: the model, a node of its source file, then any other
   *  child — a light the file carried, a node a page placed. */
  override getObjectByName(name: string): Object3D | undefined {
    if (this.name === name) return this;
    const graph = findGraphNode(this.record.scene.source, name);
    return graph ? this.nodeOf(graph) : super.getObjectByName(name);
  }
  /** The scene node of source node `index` (`nodeOf`), the nodes below it and its radius
   *  (`graphSubtree`): what the physics moves a body's node by. `null` where the cache numbers
   *  its nodes otherwise than the source (a partitioned scene). */
  _nodeAt(index: number) {
    const nodes = this.record.scene.nodes;
    if (!nodes?.[index]) return null;
    return { node: this.nodeOf(nodes[index]), ...graphSubtree(nodes, index) };
  }
  constructor(record: ModelRecord) {
    super();
    this.record = record;
    this.type = 'LoadedModel';
    const flat = hostWorldBounds(record.scene.source, emptyWorldBox());
    this.bounds = new Box3(
      new Vector3(flat[0], flat[1], flat[2]),
      new Vector3(flat[3], flat[4], flat[5]),
    );
  }
  /** Refused: a model is loaded again with `scene.load`, never cloned. */
  protected override blank(): this {
    throw new EngineError('UNSUPPORTED_SCENE_UPDATE', 'A LoadedModel cannot be cloned');
  }
  /** The model's compiled manifest — its primitives, `sourceTriangles` — and `clusters`, the
   *  clusters its pages hold, every level of its DAGs counted. */
  get metadata() {
    const manifest = this.record.metadata;
    const clusters = manifest.primitives.reduce((sum, { pages }) => sum + pages.length, 0);
    return { ...manifest, clusters };
  }
  override localBounds() {
    return this.bounds;
  }
}

/**
 * Reads a compiled model — its manifest, then its source graph (`loadPreparedScene`) — for a
 * world. `textureSource: 'cache'` leaves the images whose levels the cache baked unread: what a
 * WebGPU world's first model does; any other path samples the images themselves. `lazy` holds the
 * manifest by the view (#751), as a WebGL2 world does, whose session mounts it in place. `onProgress`
 * hears `bytes` against the files it reads (`plannedFiles`) as each chunk lands (`byteMeter`), the
 * manifest read, the scene tables read, then each resource the scene reads (`loadPreparedScene`).
 */
export async function loadModel(
  manifestUrl: string,
  options: {
    scope?: AssetScope;
    signal?: AbortSignal;
    textureSource: 'host' | 'cache';
    lazy?: boolean;
    onProgress?: (event: JobProgress) => void;
  },
): Promise<LoadedModel> {
  const { signal, textureSource, onProgress } = options;
  const meter = onProgress
    ? byteMeter((completed, total) =>
        onProgress({ phase: 'bytes', completed, total, message: `${completed} of ${total} bytes` }),
      )
    : unmetered;
  // A scope the page named is enforced; none named, the model is read at the one its pointer
  // declares (`loadClusterManifest`).
  const loaded = await loadClusterManifest(manifestUrl, options.scope, signal, meter, options.lazy);
  const { metadata, metadataUrl, base, declared, pages } = loaded,
    scope = metadata.scope;
  onProgress?.({ phase: 'manifest', completed: 1, total: 1, message: `Read ${metadataUrl}` });
  const [scene, imported] = await Promise.all([
    loadPreparedScene(
      {
        manifestUrl,
        textureSource,
        meter,
        pages,
        onTables: () => meter.plan(plannedFiles(declared, base, metadata)),
        onPreparation: (event) => onProgress?.({ ...event }),
      },
      metadata,
      SCENE_FILE,
      base,
      scope,
      false,
      signal,
      () => {},
      () => {},
    ).then((read) => {
      // The framing buffer serves a session's first frame; a world frames with its own camera.
      read.framingLot?.release();
      return read;
    }),
    loadImportedLights(base, signal, meter),
  ]);
  meter.settle();
  loaded.settle();
  const model = new LoadedModel({
    manifestUrl,
    metadataUrl,
    base,
    metadata,
    scene: { ...scene, framingLot: null },
    textureSource,
  });
  for (const record of imported.lights) {
    const lamp = lightFromRecord(record);
    model._addFromFile(lamp, lamp.target);
  }
  return model;
}
