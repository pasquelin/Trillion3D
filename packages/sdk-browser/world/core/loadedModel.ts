import { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import { Box3 } from '../../../sdk-core/src/world/math/box3.ts';
import { Vector3 } from '../../../sdk-core/src/world/math/vector3.ts';
import { lightFromRecord, type Light } from '../../../sdk-core/src/world/light/light.ts';
import { loadImportedLights } from '../../importedLights.ts';
import type { ClusterManifest, AssetScope } from '../../../sdk-core/src/index.ts';
import { loadClusterManifest } from '../../manifestLoad.ts';
import { loadPreparedScene } from '../../explorerScene.ts';
import { emptyWorldBox, hostWorldBounds } from '../../hostWorldBounds.ts';
import type { ExplorerScene } from '../../explorerPrepare.ts';

/** A compiled model as the world holds it: its manifest, and the graph its loader built. */
export type ModelRecord = {
  manifestUrl: string;
  metadataUrl: string;
  base: string;
  metadata: ClusterManifest;
  scene: ExplorerScene;
  /** Where its images were read: `cache` left the baked ones to the levels the session reads. */
  textureSource: 'host' | 'cache';
};

/**
 * A compiled model added to a scene like any other object: its pages stream by what the frame
 * reads, and its node poses it. `bounds` is the box it spans in its own frame.
 */
export class LoadedModel extends Object3D {
  readonly isLoadedModel = true as const;
  readonly bounds: Box3;
  /** Lights under the model — those the source file carried, as nodes: a page edits, moves or
   *  removes them like its own, and they move with the model. */
  get lights(): Light[] {
    return this.children.filter((child) => (child as Light).isLight === true) as Light[];
  }

  readonly record: ModelRecord;
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
    model.add(lamp, lamp.target);
  }
  return model;
}
