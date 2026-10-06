import type { SceneProxy } from '../../contracts/proxy.ts';
import { createProxyPoses, proxyNodeDelta, proxyStretch } from './proxyPoses.ts';
import { createProxySettling } from './proxySettling.ts';
import { createProxyLeaves } from './proxyLeaves.ts';
import { createProxyRefit } from './proxyRefit.ts';

/** What a sync changed: owners moved (the tree was refitted), leaves settled, or nothing. */
export type ProxySync = 'moved' | 'settled' | null;

/**
 * A session owns its mutable tree and triangles; cached geometry and provenance remain immutable.
 * A leaf holding a moved triangle turns owned (`proxyLeaves.ts`): canonical, traced under its
 * owners' poses. Once still, each owned leaf whose groups' owners agree is written at that pose
 * and rays read no owner word for it again; a leaf holding a group whose owners stand apart (a
 * door merged with its frame) stays owned, alone. Motion resuming the frame after a settle made
 * it useless: settling then waits out that gap, so slow motion never rewrites triangles each
 * cycle; later motion clears the gap, so motion that stops settles on its first still frame.
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
  const { transforms, groupsOf, binds, inverses, deltas, identity } = createProxyPoses(proxy, data);
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
  const settleLeaves = createProxySettling(data, canonical, groupOf, leaves, deltas);
  /** Owned leaves written at their settled pose; the wait for a still streak is over. */
  const settle = () => {
    pending = false;
    return settleLeaves();
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
        proxyNodeDelta(delta, world, bind, source === -1 ? identity : inverses[source], identity);
        let moved = false;
        for (let i = 0; i < 16; i++) moved ||= Math.fround(delta[i]) !== deltas[node][i];
        if (!moved) continue;
        deltas[node].set(delta);
        for (const group of groups) dirty.add(group);
      }
      if (!dirty.size) {
        if (++still <= gap || !pending || !settle()) return null;
        revision++;
        return 'settled';
      }
      gap = still <= gap + 1 ? still : 0;
      still = 0;
      pending = true;
      // Motion resumes from the canonical triangles of each leaf it touches.
      for (const group of dirty)
        for (let rank = refit.starts[group]; rank < refit.starts[group + 1]; rank++) {
          const leaf = leaves.leafOf[refit.slots[rank]];
          if (leaf !== 0xffffffff && !leaves.owned[leaf]) leaves.own(leaf);
        }
      stretch = proxyStretch(groupsOf.keys(), deltas);
      refit(dirty, transforms, bounds);
      revision++;
      return 'moved';
    },
  };
}
