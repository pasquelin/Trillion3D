import type * as THREE from 'three';
import {
  bumpResources,
  bumpScene,
  bumpView,
  createFrameHold,
  createFrameRevisions,
} from './frameRevisions.ts';
import { createViewRevision } from './frameViewRevision.ts';
import { createHostSceneWatch, type WatchedSources } from './hostSceneWatch.ts';
import {
  createEngineCamera,
  readCameraWorld,
  type CameraMotion,
  type EngineCamera,
  type HostCamera,
} from './cameraWorld.ts';
import { resolvePixelError } from './pageSelection.ts';
import type { HostWorldPlacements } from './hostWorldPlacements.ts';

export type FrameGateCore = ReturnType<typeof createFrameGateCore>;

/** What frame entry rereads from the source graph, or what to reread it from when the list itself
 *  is rebuilt only on a scene change: the call then has nothing to build per frame. */
type FrameGateSources = WatchedSources | (() => WatchedSources);

/**
 * Frame gate shared by both engines: the three revisions, the view origin, the reread of the graph
 * the host may write, and the held-frame witness. `holdValues` is how many values a frame signature
 * of this engine carries.
 */
export function createFrameGateCore(holdValues: number) {
  const revisions = createFrameRevisions();
  const viewRevision = createViewRevision();
  const hold = createFrameHold(holdValues);
  const sceneWatch = createHostSceneWatch();
  // Camera the engine owns: frame entry copies the host's into it, once, and everything downstream
  // reads it. Allocated here, never per frame.
  const cam = createEngineCamera();
  let worldsRevision = 0,
    watchRevision = -1,
    pixelError = 0;
  const gate = {
    revisions,
    hold,
    /** Engine camera of the current frame, as `enterFrame` has just copied it. */
    cam,
    /** Quality threshold `enterFrame` has just resolved for the current frame. */
    get pixelError() {
      return pixelError;
    },
    /** The scene moved: matrices, materials, instances, lights, diagnostic view. What the engine
     *  wrote into the source graph on the way is announced by this revision: the watch does not
     *  announce it a second time. */
    sceneChanged() {
      bumpScene(revisions);
      sceneWatch.settle();
    },
    /**
     * Resources moved: a page's bytes, residency, replaced geometry, and anything that arrives
     * off the frame thread — a program that finishes compiling, a proxy adopted when a promise
     * resolves. No step of the current frame will write it, and the next frame would read it
     * without any counter announcing it: so the revision is incremented on arrival, which also
     * breaks the hold.
     */
    resourcesChanged: () => bumpResources(revisions),
    /** The target no longer carries this view's frame: a capture rendered there from another camera. */
    viewReplaced: () => bumpView(revisions),
    /** Rereads this frame's view; returns true if any of its numbers moved. */
    viewChanged(vue: EngineCamera, viewport: readonly [number, number] | undefined, error: number) {
      return viewRevision.read(
        revisions,
        vue,
        viewport ? viewport[0] : -1,
        viewport ? viewport[1] : -1,
        error,
      );
    },
    /**
     * Declares the scene changed when the host wrote the source nodes directly — a pose, a
     * visibility, a light — without going through the engine. Call BEFORE `held()`: without
     * that the frame would be held on a stale scene. Nothing is walked or reread here: the
     * writes themselves incremented the watch's revision, and one integer is compared.
     *
     * The hooked node list is rebuilt after a scene change that may have reshaped it — one more
     * instance, a light set after the fact, a node reparented or a light retargeted by the host
     * — never per frame, and never after a pose write, which changes no node's membership.
     */
    readScene(source: THREE.Object3D, drawn: FrameGateSources) {
      if (watchRevision !== revisions.scene) {
        sceneWatch.observe(source, typeof drawn === 'function' ? drawn() : drawn);
        watchRevision = revisions.scene;
      }
      if (!sceneWatch.changed()) return;
      bumpScene(revisions);
      if (!sceneWatch.reshaped()) watchRevision = revisions.scene;
    },
    /** True when two identical frames followed each other and nothing has moved since. */
    held: () => hold.stable && hold.same(revisions),
    /** Walks the hierarchy once per scene revision; returns true when it did. A frame nothing
     *  has touched walks nothing: `readScene` is what knows if nothing moved. What is walked is
     *  the engine index: the host scene is neither read nor written. */
    updateWorlds(worlds: HostWorldPlacements) {
      if (worldsRevision === revisions.scene) return false;
      worldsRevision = revisions.scene;
      worlds.refresh();
      return true;
    },
    /** The hierarchy already carries the current revision's matrices: written by whoever just
     *  walked them itself, on the only subtree it moved. */
    noteWorldsUpdated() {
      worldsRevision = revisions.scene;
    },
    /** Lets go of the source graph: its writes no longer reach this gate. */
    release: () => sceneWatch.release(),
    /**
     * Frame entry, in the order every engine follows, and which carries the hold verdict.
     *
     * The camera world pose, ancestors included, is resolved and copied into the engine camera
     * first and once — view, view-projection, frustum planes, eye: the adaptive threshold reads
     * it, then the view fingerprint (contract and guarantees: `cameraWorld.ts`). Camera speed is
     * read every frame, held or not: skipping it would skew the adaptive threshold of the first
     * frame that moves again. Finally the host may write the source graph without going through
     * the engine: the reread is what announces it, and it precedes the hold decision.
     */
    enterFrame(
      context: { pixelError?: number; lodAdaptive?: boolean },
      camera: HostCamera,
      motion: CameraMotion,
      viewport: readonly [number, number] | undefined,
      source: THREE.Object3D,
      drawn: FrameGateSources,
    ) {
      readCameraWorld(cam, camera);
      pixelError = resolvePixelError(context, cam, motion);
      gate.viewChanged(cam, viewport, pixelError);
      gate.readScene(source, drawn);
      return gate.held();
    },
  };
  return gate;
}
