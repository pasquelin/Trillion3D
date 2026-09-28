import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { isDrawnNode } from '../../host/graph/kinds.ts';
import type { HostMesh } from '../../host/resources.ts';
import { firstMaterial } from '../../scene/materialSide.ts';
import { physicsLink } from '../../physics/physicsLink.ts';

/** A list member's surface still sends it where it stands: a see-through surface to the
 *  see-through list, an opaque one to the opaque list unless `copies` names it. */
const see = (mesh: HostMesh) => !!firstMaterial(mesh.material)?.transparent;

/**
 * THE DRAW LISTS OF A DISPLAY GRAPH, KEPT BETWEEN IMAGES (#984, CPU-22): every visible mesh under
 * the graph's children in graph order, split into the opaque ones and the see-through ones — a
 * transparent surface, or a transparent copy `copies` names. `refresh()` walks the graph again
 * only when it may have changed shape; otherwise the lists stand, and it reads only their members'
 * surfaces.
 *
 * INVARIANT: after `refresh()` the lists are exactly those a full walk of the graph would find, in
 * the same order. What changes them is heard by the engine's own change signal, the scene link
 * (`SceneLink`), set on every node here and carried by `add` to every node that joins: a node
 * added or removed (`structure`), a node the last walk reached shown or hidden (`pose`, which a
 * move also sends: a node whose `visible` is as the walk read it changes nothing; one under a
 * hidden node joins when that node is shown). A surface turned see-through or back, set or
 * written in place, is read on the members themselves. The
 * copies list only grows (`growBlendCopies`): a longer one walks again. A link the graph already
 * had keeps hearing everything, and gets the graph back at `dispose`.
 */
export function createDrawLists(scene: Object3D, copies: readonly object[]) {
  const copied = new Set<object>();
  const opaque: HostMesh[] = [],
    seeThrough: HostMesh[] = [];
  // Each node the last walk reached, and whether it was shown: a move leaves it as it was.
  const shown = new WeakMap<Object3D, boolean>();
  let stale = true;
  const previous = scene._link;
  // The link chained as the physics chains its own (`physicsLink`): the one it replaces hears all.
  // A scene root tells its link its background and fog (`WorldSceneLink`): nobody else hears them.
  const link = {
    background() {},
    fog() {},
    ...physicsLink(previous, {
      pose(node) {
        const was = shown.get(node);
        if (was !== undefined && was !== node.visible) stale = true;
      },
      structure() {
        stale = true;
      },
      content() {},
    }),
  };
  scene.traverse((node) => (node._link = link));
  const collect = (node: Object3D) => {
    shown.set(node, node.visible);
    if (!node.visible) return;
    if (isDrawnNode(node)) (copied.has(node) || see(node) ? seeThrough : opaque).push(node);
    for (const child of node.children) collect(child);
  };
  /** A member whose surface moved it to the other list. */
  const resorted = () => {
    for (const mesh of opaque) if (see(mesh)) return true;
    for (const mesh of seeThrough) if (!copied.has(mesh) && !see(mesh)) return true;
    return false;
  };
  return {
    /** Visible opaque meshes, in graph order: read, never written. */
    opaque: opaque as readonly HostMesh[],
    /** Visible see-through meshes and copies, in graph order: read, never written. */
    seeThrough: seeThrough as readonly HostMesh[],
    /** Brings the lists to the graph as it stands. */
    refresh() {
      for (let i = copied.size; i < copies.length; i++) {
        copied.add(copies[i]);
        stale = true;
      }
      if (!stale && !resorted()) return;
      stale = false;
      opaque.length = seeThrough.length = 0;
      for (const child of scene.children) collect(child);
    },
    /** Gives the graph back the link it had. */
    dispose() {
      scene.traverse((node) => (node._link = previous));
    },
  };
}
