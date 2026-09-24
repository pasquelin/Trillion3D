import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import { isLight, lightsUnder, type createWorldLights } from './worldLights.ts';
import type { createWorldContents } from './worldContents.ts';
import type { createWorldBackground } from './worldBackground.ts';
import type { WorldSceneLink } from './scene.ts';

type Parts = {
  contents: ReturnType<typeof createWorldContents>;
  lights: ReturnType<typeof createWorldLights>;
  /** Asks the session for a new frame. */
  invalidate: () => void;
  /** The lights are written again before the next frame, which it asks for. */
  relight: () => void;
  /** Folds a scene change into the next resolution. */
  schedule: () => void;
  background: ReturnType<typeof createWorldBackground>;
};

/**
 * What a world's scene tells its runtime: a pose moved (the row is written before the next
 * frame, the lights again when one it holds moved), a parent's children changed, or a mesh's
 * geometry or material was written (both resolved again, off the frame). A background change is
 * no change of structure: it is written before the next frame, nothing resolved.
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
    background() {
      parts.background.changed();
      parts.invalidate();
    },
  };
}
