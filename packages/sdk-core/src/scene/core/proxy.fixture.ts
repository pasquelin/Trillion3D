import { SCENE_PROXY_VERSION, type SceneProxy } from '../../contracts/proxy.ts';
import { createProxyRefit } from './proxyRefit.ts';

export function proxyIdentity() {
  return new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

/** One retained plane with two coincident owners, plus an unrelated source node. */
export function ownedProxy(): SceneProxy {
  return {
    version: SCENE_PROXY_VERSION,
    url: 'proxy.bin',
    sha256: 'fixture',
    bytes: 0,
    errorMetres: 0.1,
    errorFloorMetres: 0.05,
    cellMetres: 0.5,
    triangleBudget: 300000,
    bounds: [0, 0, 0, 1, 1, 0],
    triangles: 1,
    nodes: 1,
    groups: 1,
    owners: 2,
    instances: 3,
    data: {
      triangles: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      albedo: new Uint32Array([0xffffffff]),
      nodeBounds: new Float32Array([0, 0, 0, 1, 1, 0]),
      nodeChildren: new Uint32Array([0xff000000, 0x0101ffff, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      triangleGroups: new Uint32Array([0]),
      groupOffsets: new Uint32Array([0, 2]),
      owners: new Uint32Array([0, 0xffffffff, 1, 0xff00ff00]),
      bindWorlds: new Float64Array([...proxyIdentity(), ...proxyIdentity(), ...proxyIdentity()]),
      sourceParents: new Int32Array([-1, -1, -1]),
      sourceMeshes: new Int32Array([0, 0, -1]),
    },
  };
}

/**
 * A `side`×`side` floor of small tilted triangles, one metre high at most, one owner and source node each, in a
 * four-wide tree of `leaf`-triangle leaves over their Morton order: a real, deep proxy tree.
 * Its boxes and quantized children come from the engine's own refit at the bind pose.
 */
export function floorProxy(side: number, leaf: number): SceneProxy {
  const count = side * side,
    triangles = new Float32Array(count * 9);
  for (let t = 0; t < count; t++) {
    let x = 0,
      y = 0;
    for (let bit = 0; bit < 16; bit++) {
      x |= ((t >> (2 * bit)) & 1) << bit;
      y |= ((t >> (2 * bit + 1)) & 1) << bit;
    }
    triangles.set([x, y, 0, x + 0.9, y, 0, x, y + 0.9, 0.9], t * 9);
  }
  const children: number[][] = [];
  const node = (first: number, end: number): number => {
    const index = children.length,
      slots: number[] = [];
    children.push(slots);
    const part = Math.max(leaf, Math.ceil((end - first) / 4));
    for (let at = first; at < end; at += part) {
      const stop = Math.min(end, at + part);
      const size = stop - at;
      if (size <= leaf) slots.push(0, (0xff000000 | (size << 16)) >>> 0, at);
      else slots.push(0, 0xff000000, node(at, stop));
    }
    while (slots.length < 12) slots.push(0, 0, 0);
    return index;
  };
  node(0, count);
  const owners = new Uint32Array(count * 2);
  for (let t = 0; t < count; t++) owners.set([t, 0xffffffff], t * 2);
  const data = {
    triangles,
    albedo: new Uint32Array(count).fill(0xffffffff),
    nodeBounds: new Float32Array(children.length * 6),
    nodeChildren: new Uint32Array(children.flat()),
    triangleGroups: Uint32Array.from({ length: count }, (_, t) => t),
    groupOffsets: Uint32Array.from({ length: count + 1 }, (_, g) => g),
    owners,
    bindWorlds: new Float64Array(count * 16),
    sourceParents: new Int32Array(count).fill(-1),
    sourceMeshes: new Int32Array(count).fill(-1),
  };
  const transforms = new Float32Array(count * 16);
  for (let t = 0; t < count; t++) {
    data.bindWorlds.set(proxyIdentity(), t * 16);
    transforms.set(proxyIdentity(), t * 16);
  }
  const bounds = [0, 0, 0, 0, 0, 0];
  createProxyRefit(data)(new Set(data.triangleGroups), transforms, bounds);
  return {
    ...ownedProxy(),
    bounds: bounds as SceneProxy['bounds'],
    triangles: count,
    nodes: children.length,
    groups: count,
    owners: count,
    instances: count,
    data,
  };
}

/**
 * Two leaves of one node: a plane owned by source 0 alone, and beside it, two metres along x, a
 * plane shared by sources 1 and 2 — a door merged with its frame once source 1 moves alone.
 */
export function mixedProxy(): SceneProxy {
  const data = {
    triangles: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0]),
    albedo: new Uint32Array([0xffffffff, 0xffffffff]),
    nodeBounds: new Float32Array(6),
    nodeChildren: new Uint32Array([0, 0x01010000, 0, 0, 0x01010000, 1, 0, 0, 0, 0, 0, 0]),
    triangleGroups: new Uint32Array([0, 1]),
    groupOffsets: new Uint32Array([0, 1, 3]),
    owners: new Uint32Array([0, 0xffffffff, 1, 0xffffffff, 2, 0xff00ff00]),
    bindWorlds: new Float64Array([...proxyIdentity(), ...proxyIdentity(), ...proxyIdentity()]),
    sourceParents: new Int32Array([-1, -1, -1]),
    sourceMeshes: new Int32Array([-1, -1, -1]),
  };
  const transforms = new Float32Array([...proxyIdentity(), ...proxyIdentity(), ...proxyIdentity()]);
  const bounds = [0, 0, 0, 0, 0, 0];
  createProxyRefit(data)(new Set([0, 1]), transforms, bounds);
  return {
    ...ownedProxy(),
    bounds: bounds as SceneProxy['bounds'],
    triangles: 2,
    groups: 2,
    owners: 3,
    data,
  };
}
