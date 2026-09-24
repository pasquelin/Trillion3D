import type { SceneLink } from '../../../sdk-core/src/world/object/object3d.ts';

/** The scene link a world's runtime set, with the physics told of every change too; what else
 *  that link answers (the scene's `background`) is kept. */
export function physicsLink(link: SceneLink | null, physics: Omit<SceneLink, 'posed'>): SceneLink {
  return {
    ...link,
    pose(node) {
      link?.pose(node);
      physics.pose(node);
    },
    // Only the physics places nodes by the batch: nothing to tell it of its own writes.
    posed(nodes) {
      link?.posed(nodes);
    },
    structure(node) {
      link?.structure(node);
      physics.structure(node);
    },
    content(node) {
      link?.content(node);
      physics.content(node);
    },
  };
}
