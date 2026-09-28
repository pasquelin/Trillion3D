import { SCENE_PROXY_VERSION, type SceneProxy } from '../../contracts/proxy.ts';

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
    },
  };
}
