import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { Box3 } from '../../../../sdk-core/src/world/math/box3.ts';
import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts';
import { lightFromRecord, type Light } from '../../../../sdk-core/src/world/light/light.ts';
import { loadImportedLights } from '../../lighting/importedLights.ts';
import type { ClusterManifest, AssetScope } from '../../../../sdk-core/src/index.ts';
import { loadClusterManifest } from '../../scene/manifestLoad.ts';
import { loadPreparedScene } from '../scene/scene.ts';
import { emptyWorldBox, hostWorldBounds } from '../../host/world/bounds.ts';
import type { ExplorerScene } from '../session/prepare.ts';
import { findGraphNode, modelNode } from './modelNodes.ts';
import type { HostGraphNode } from '../../host/scene/graphNodes.ts';

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
  private readonly looked = new Map<HostGraphNode, Object3D>();
  /** The scene node of `graph`, built with its missing ancestors on first ask (`modelNode`). */
  private nodeOf(graph: HostGraphNode): Object3D {
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
  /** The model's compiled manifest — its primitives, `sourceTriangles` — and `clusters`, the
   *  clusters its pages hold, every level of its DAGs counted. */
  get metadata() {
    const manifest = this.record.metadata;
    const clusters = manifest.primitives.reduce(
      (sum, primitive) => sum + primitive.pages.length,
      0,
    );
    return { ...manifest, clusters };
  }
  override localBounds() {
    return this.bounds;
  }
}

/**
 * Reads a compiled model — its manifest, then its source graph (`loadPreparedScene`) — for a
 * world. `textureSource: 'cache'` leaves the images whose levels the cache baked unread: what a
 * WebGPU world's first model does; any other path samples the images themselves.
 */
export async function loadModel(
  manifestUrl: string,
  options: { scope?: AssetScope; signal?: AbortSignal; textureSource: 'host' | 'cache' },
): Promise<LoadedModel> {
  const { signal, textureSource } = options;
  // A scope the page named is enforced; none named, the model is read at the one its pointer
  // declares (`loadClusterManifest`).
  const loaded = await loadClusterManifest(manifestUrl, options.scope, signal);
  const { metadata, metadataUrl, base } = loaded,
    scope = metadata.scope;
  const [scene, imported] = await Promise.all([
    loadPreparedScene(
      { manifestUrl, textureSource },
      metadata,
      'source.gltf',
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
    loadImportedLights(base, signal),
  ]);
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
