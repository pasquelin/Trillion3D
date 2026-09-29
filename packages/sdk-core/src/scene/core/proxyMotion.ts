import type { SceneProxy } from '../../contracts/proxy.ts';
import { invertMatrix4 } from '../../math/matrix/matrix4Inverse.ts';
import { proxyAffineDelta } from './proxyDelta.ts';
import { createProxyRefit } from './proxyRefit.ts';

/**
 * A session owns its mutable tree and triangles; cached geometry and provenance remain immutable.
 * Moving owners are traced as canonical triangles under their poses (`dynamic`). The first sync
 * with no motion settles: each triangle is written at its owners' common pose and rays go back to
 * the still path, which reads no owner word. A group whose owners stand apart cannot be one
 * triangle, so it keeps the proxy dynamic.
 */
export function createSceneProxyMotion(proxy: SceneProxy) {
  const canonical = proxy.data.triangles;
  const data = {
    ...proxy.data,
    triangles: canonical.slice(),
    nodeBounds: proxy.data.nodeBounds.slice(),
    nodeChildren: proxy.data.nodeChildren.slice(),
  };
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
  const refit = createProxyRefit(data),
    dirty = new Set<number>();
  const delta = new Float64Array(16);
  let revision = 0,
    stretch = 1,
    moving = false,
    settled = false;
  /** Every owner of each group under one pose: the only case one triangle still describes. */
  const coincident = () => {
    for (let group = 0; group < proxy.groups; group++) {
      const first = deltas[data.owners[data.groupOffsets[group] * 2]];
      for (let owner = data.groupOffsets[group] + 1; owner < data.groupOffsets[group + 1]; owner++)
        for (let i = 0; i < 16; i++)
          if (deltas[data.owners[owner * 2]][i] !== first[i]) return false;
    }
    return true;
  };
  /** Writes each triangle at its owners' pose. The pose's f32 evaluation, rounded once, stays
   *  inside the padded boxes the last refit gave it: the tree already covers the settled pose. */
  const settle = () => {
    const { triangles, triangleGroups, groupOffsets, owners } = data;
    for (let t = 0; t < triangleGroups.length; t++) {
      const m = deltas[owners[groupOffsets[triangleGroups[t]] * 2]];
      for (let v = 0; v < 9; v += 3)
        for (let a = 0; a < 3; a++)
          triangles[t * 9 + v + a] =
            m[a] * canonical[t * 9 + v] +
            m[a + 4] * canonical[t * 9 + v + 1] +
            m[a + 8] * canonical[t * 9 + v + 2] +
            m[a + 12];
    }
    moving = false;
    settled = true;
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
      proxy.instances * 16 * 8 +
      data.bindWorlds.byteLength +
      data.nodeBounds.byteLength +
      data.nodeChildren.byteLength +
      refit.bytes +
      identity.byteLength +
      delta.byteLength,
    /** Rays read owner poses: something moved since the proxy last settled. */
    get dynamic() {
      return moving;
    },
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
    sync(worldOf: (sourceNode: number) => ArrayLike<number> | undefined) {
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
        if (!moving || !coincident()) return false;
        settle();
        revision++;
        return true;
      }
      // Motion resumes from the canonical triangles, under the owners' poses.
      if (settled) data.triangles.set(canonical);
      settled = false;
      moving = true;
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
      return true;
    },
  };
}
