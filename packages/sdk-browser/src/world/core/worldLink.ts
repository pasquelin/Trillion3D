import type { Object3D, SceneLink } from '../../../../sdk-core/src/world/object/object3d.ts';
import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import type { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import { isLight, lightsUnder, type createWorldLights } from './worldLights.ts';
import type { createWorldContents } from './worldContents.ts';
import type { WorldSceneLink } from './scene.ts';
import type { Batch } from './worldBatches.ts';

type Parts = {
  contents: ReturnType<typeof createWorldContents>;
  lights: ReturnType<typeof createWorldLights>;
  /** Asks the session for a new frame. */
  invalidate: () => void;
  /** The lights are written again before the next frame, which it asks for. */
  relight: () => void;
  /** Folds a scene change into the next resolution. */
  schedule: () => void;
};

/**
 * What a world's scene tells its runtime: a pose moved (the row is written before the next
 * frame, the lights again when one it holds moved), a parent's children changed, or a mesh's
 * geometry or material was written (both resolved again, off the frame). A background change is
 * no change of structure: a frame is asked, which writes it (`worldBackground.ts`).
 */
export function createWorldLink(parts: Parts): WorldSceneLink {
  const { contents, lights, schedule } = parts;
  return {
    pose(node: Object3D) {
      contents.poses.moved(node);
      if (!isLight(node) || node.children.length) lights.boundsMoved();
      if (lights.held && lightsUnder(node)) parts.relight();
      else parts.invalidate();
    },
    posed(nodes: readonly Object3D[]) {
      let relight = false;
      for (const node of nodes) {
        contents.poses.moved(node);
        relight ||= !!lights.held && lightsUnder(node);
      }
      lights.boundsMoved();
      if (relight) parts.relight();
      else parts.invalidate();
    },
    structure(parent: Object3D) {
      contents.changed(parent);
      lights.boundsMoved();
      schedule();
    },
    content(node: Object3D) {
      if (isLight(node)) return parts.relight();
      contents.stale(node as Mesh);
      lights.boundsMoved();
      schedule();
    },
    seat: (node) => {
      const seat = contents.seats.get(node as Mesh);
      return seat && seat.batch.rows && seat.row >= 0 ? seat : null;
    },
    seatEpoch: () => contents.seatEpoch,
    placed(batch, from, to) {
      contents.poses.touchRange(batch as Batch, from, to);
      lights.boundsMoved();
      parts.invalidate();
    },
    background: parts.invalidate,
  };
}

/** The link of a camera outside the scene: a move asks for a frame, nothing else. */
const cameraSceneLink = (invalidate: () => void): SceneLink => ({
  pose: invalidate,
  posed: invalidate,
  structure: () => {},
  content: () => {},
});

/** Gives a camera outside the scene the link that makes its moves redraw; one that already has
 *  a link — a camera inside the scene — keeps its own. */
export function cameraAdopter(invalidate: () => void) {
  const link = cameraSceneLink(invalidate);
  return (camera: Camera) => {
    if (!camera._link) camera._link = link;
    return camera;
  };
}
