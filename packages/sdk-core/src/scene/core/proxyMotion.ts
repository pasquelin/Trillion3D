import type { SceneProxy } from '../../contracts/proxy.ts';
import { invertMatrix4 } from '../../math/matrix/matrix4Inverse.ts';
import { transformAffinePoint } from '../../math/primitives/vector.ts';
import { proxyAffineDelta } from './proxyDelta.ts';
import { createProxyLeaves } from './proxyLeaves.ts';
import { createProxyRefit } from './proxyRefit.ts';

/** What a sync changed: owners moved (the tree was refitted), leaves settled, or nothing. */
export type ProxySync = 'moved' | 'settled' | null;

/**
 * A session owns its mutable tree and triangles; cached geometry and provenance remain immutable.
 * A leaf holding a moved triangle turns owned (`proxyLeaves.ts`): canonical, traced under its
 * owners' poses. Once still, each owned leaf whose groups' owners agree is written at that pose
 * and rays read no owner word for it again; a leaf holding a group whose owners stand apart (a
 * door merged with its frame) stays owned, alone. Settling waits until the still streak exceeds
 * the last gap between two motions: motion slower than the frame rate never rewrites triangles
 * each cycle, and motion that simply stops settles on its first still frame.
 */
export function createSceneProxyMotion(proxy: SceneProxy) {
  const canonical = proxy.data.triangles,
    groupOf = proxy.data.triangleGroups;
  const data = {
    ...proxy.data,
    triangles: canonical.slice(),
    triangleGroups: groupOf.slice(),
    nodeBounds: proxy.data.nodeBounds.slice(),
    nodeChildren: proxy.data.nodeChildren.slice(),
  };
  const leaves = createProxyLeaves(
    data.nodeChildren,
    data.triangleGroups,
    data.triangles,
    canonical,
  );
  const transforms = new Float32Array(proxy.instances * 16);
  const groupsOf = new Map<number, Set<number>>();
  const binds: Float64Array[] = [],
    inverses: Float64Array[] = [],
    deltas: Float32Array[] = [];
  const identity = new Float64Array(16);
  identity[0] = identity[5] = identity[10] = identity[15] = 1;
  for (let node = 0; node < proxy.instances; node++) {
    const bind = data.bindWorlds.subarray(node * 16, node * 16 + 16);
    binds.push(bind);
    inverses.push(invertMatrix4(new Float64Array(16), bind));
    deltas.push(transforms.subarray(node * 16, node * 16 + 16));
    deltas[node].set(identity);
  }
  for (let group = 0; group < proxy.groups; group++)
    for (let owner = data.groupOffsets[group]; owner < data.groupOffsets[group + 1]; owner++) {
      const node = data.owners[owner * 2];
      let groups = groupsOf.get(node);
      if (!groups) groupsOf.set(node, (groups = new Set()));
      groups.add(group);
    }
  const bounds = [...proxy.bounds] as SceneProxy['bounds'];
  // The refit reads canonical triangles and plain groups, whatever the leaves hold.
  const refit = createProxyRefit({ ...data, triangles: canonical, triangleGroups: groupOf }),
    dirty = new Set<number>();
  const delta = new Float64Array(16);
  let revision = 0,
    stretch = 1,
    // Owned leaves wait to settle; still syncs since the last motion; the streak before it.
    pending = false,
    still = 0,
    gap = 0;
  const { groupOffsets, owners } = data;
  /** Every owner of the group under one pose: the only case one triangle still describes. */
  const coincident = (group: number) => {
    const first = deltas[owners[groupOffsets[group] * 2]];
    for (let owner = groupOffsets[group] + 1; owner < groupOffsets[group + 1]; owner++)
      for (let i = 0; i < 16; i++) if (deltas[owners[owner * 2]][i] !== first[i]) return false;
    return true;
  };
  /** A triangle at its owners' pose. The pose's f32 evaluation, rounded once, stays inside the
   *  padded boxes the last refit gave it: the tree already covers the settled pose. */
  const write = (t: number) => {
    const m = deltas[owners[groupOffsets[groupOf[t]] * 2]];
    for (let v = t * 9; v < t * 9 + 9; v += 3)
      transformAffinePoint(data.triangles, m, canonical[v], canonical[v + 1], canonical[v + 2], v);
  };
  /** Poses every owned leaf whose groups all agree; the others stay owned until motion. */
  const settle = () => {
    pending = false;
    let settled = false;
    for (let leaf = 0; leaf < leaves.count; leaf++) {
      if (!leaves.owned[leaf]) continue;
      let agree = true;
      for (let t = leaves.firsts[leaf]; agree && t < leaves.ends[leaf]; t++)
        agree = coincident(groupOf[t]);
      if (!agree) continue;
      leaves.pose(leaf, write);
      settled = true;
    }
    return settled;
  };
  return {
    data,
    transforms,
    bounds,
    triangleBoxes: refit.boxes,
    changedTriangles: refit.changed,
    /** Typed storage not already accounted by the immutable raw cache object. */
    hostBytes:
      transforms.byteLength +
      data.triangles.byteLength +
      data.triangleGroups.byteLength +
      leaves.bytes +
      proxy.instances * 16 * 8 +
      data.bindWorlds.byteLength +
      data.nodeBounds.byteLength +
      data.nodeChildren.byteLength +
      refit.bytes +
      identity.byteLength +
      delta.byteLength,
    /** Some leaf is traced under its owners' poses. */
    get dynamic() {
      return leaves.ownedCount > 0;
    },
    /** Owned leaves wait for a still streak to settle: the host keeps syncing each frame. */
    get settling() {
      return pending;
    },
    /** Column ranges the last syncs rewrote (`proxyLeaves.ts`), taken by the upload. */
    take: leaves.take,
    /** Nodes a ray may visit beyond the built tree's (`proxyRefit.ts`). */
    get grownNodes() {
      return refit.grownNodes();
    },
    get revision() {
      return revision;
    },
    get errorMetres() {
      return proxy.errorMetres * stretch;
    },
    /** Missing partition leaves follow their nearest loaded ancestor, then the scene wrapper. */
    sync(worldOf: (sourceNode: number) => ArrayLike<number> | undefined): ProxySync {
      dirty.clear();
      for (const [node, groups] of groupsOf) {
        let source = node,
          world = worldOf(source);
        while (!world && source !== -1) {
          source = data.sourceParents[source];
          world = worldOf(source);
        }
        if (!world) world = identity;
        const bind = source === -1 ? identity : binds[source];
        let unchanged = true;
        for (let i = 0; i < 16; i++) unchanged &&= Math.fround(world[i]) === Math.fround(bind[i]);
        if (unchanged) delta.set(identity);
        else {
          // Translation does not need an inverse, including an originally flattened instance.
          let translation = true;
          for (let i = 0; i < 12; i++) translation &&= world[i] === bind[i];
          if (translation) {
            delta.set(identity);
            for (let a = 0; a < 3; a++) delta[12 + a] = world[12 + a] - bind[12 + a];
          } else proxyAffineDelta(delta, bind, world, source === -1 ? identity : inverses[source]);
        }
        let moved = false;
        for (let i = 0; i < 16; i++) moved ||= Math.fround(delta[i]) !== deltas[node][i];
        if (!moved) continue;
        deltas[node].set(delta);
        for (const group of groups) dirty.add(group);
      }
      if (!dirty.size) {
        if (!pending || ++still <= gap || !settle()) return null;
        revision++;
        return 'settled';
      }
      gap = still;
      still = 0;
      pending = true;
      // Motion resumes from the canonical triangles of each leaf it touches.
      for (let t = 0; t < groupOf.length; t++) {
        const leaf = leaves.leafOf[t];
        if (dirty.has(groupOf[t]) && leaf !== 0xffffffff && !leaves.owned[leaf]) leaves.own(leaf);
      }
      stretch = 1;
      for (const node of groupsOf.keys()) {
        const m = deltas[node];
        let rows = 0,
          columns = 0;
        for (let a = 0; a < 3; a++) {
          rows = Math.max(rows, Math.abs(m[a]) + Math.abs(m[a + 4]) + Math.abs(m[a + 8]));
          columns = Math.max(
            columns,
            Math.abs(m[a * 4]) + Math.abs(m[a * 4 + 1]) + Math.abs(m[a * 4 + 2]),
          );
        }
        stretch = Math.max(stretch, Math.sqrt(rows * columns));
      }
      refit(dirty, transforms, bounds);
      revision++;
      return 'moved';
    },
  };
}
