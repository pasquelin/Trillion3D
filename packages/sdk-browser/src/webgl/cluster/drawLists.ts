import type { Object3D, SceneLink } from '../../../../sdk-core/src/world/object/object3d.ts';
import { isDrawnNode } from '../../host/graph/kinds.ts';
import type { HostMesh } from '../../host/resources.ts';
import { firstMaterial } from '../../scene/materialSide.ts';

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
 * added or removed (`structure`), a node shown or hidden (`pose`, which a move also sends: a
 * childless node that is no mesh changes nothing). A surface turned see-through or back, set or
 * written in place, is read on the members themselves; a hidden mesh joins through `pose`. The
 * copies list only grows (`growBlendCopies`): a longer one walks again. A link the graph already
 * had keeps hearing everything, and gets the graph back at `dispose`.
 */
export function createDrawLists(scene: Object3D, copies: readonly object[]) {
  const copied = new Set<object>();
  const opaque: HostMesh[] = [],
    seeThrough: HostMesh[] = [];
  let stale = true;
  const previous = scene._link;
  const link: SceneLink = {
    ...previous,
    pose(node) {
      previous?.pose(node);
      if (node.children.length || isDrawnNode(node)) stale = true;
    },
    posed(nodes) {
      previous?.posed(nodes);
    },
    structure(node) {
      previous?.structure(node);
      stale = true;
    },
    content(node) {
      previous?.content(node);
    },
  };
  scene.traverse((node) => (node._link = link));
  const collect = (node: Object3D) => {
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
      if (copied.size < copies.length) {
        for (let i = copied.size; i < copies.length; i++) copied.add(copies[i]);
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
