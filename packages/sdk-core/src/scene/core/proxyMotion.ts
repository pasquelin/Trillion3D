import type { SceneProxy } from '../../contracts/proxy.ts';
import { invertMatrix4 } from '../../math/matrix/matrix4Inverse.ts';
import { proxyAffineDelta } from './proxyDelta.ts';
import { createProxyRefit } from './proxyRefit.ts';

/** A session owns its mutable tree; cached geometry and provenance remain immutable. */
export function createSceneProxyMotion(proxy: SceneProxy) {
  const data = {
    ...proxy.data,
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
    stretch = 1;
  return {
    data,
    transforms,
    bounds,
    /** Typed storage not already accounted by the immutable raw cache object. */
    hostBytes:
      transforms.byteLength +
      proxy.instances * 16 * 8 +
      data.bindWorlds.byteLength +
      data.nodeBounds.byteLength +
      data.nodeChildren.byteLength +
      refit.bytes +
      identity.byteLength +
      delta.byteLength,
    get dynamic() {
      return revision > 0;
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
      if (!dirty.size) return false;
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
