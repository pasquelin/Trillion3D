import { SCENE_PROXY_VERSION, type SceneProxy } from '../../../packages/sdk-core/src/index.ts';

/** One bounded leaf, shared by the known-radiance fragment proof and real backend bounce setup. */
export function mirrorProxy(offsetX = 0, albedo = 0xffffffff): SceneProxy {
  const bounds: SceneProxy['bounds'] = [-0.7 + offsetX, -0.6, 1, 0.6 + offsetX, 0.71, 1];
  return {
    version: SCENE_PROXY_VERSION,
    url: 'synthetic-mirror-proxy.bin',
    sha256: '0'.repeat(64),
    bytes: 128,
    errorMetres: 0,
    errorFloorMetres: 0,
    cellMetres: 1,
    triangleBudget: 1,
    bounds,
    triangles: 1,
    nodes: 1,
    data: {
      triangles: new Float32Array([
        bounds[0],
        bounds[1],
        1,
        bounds[3],
        bounds[1],
        1,
        bounds[0],
        bounds[4],
        1,
      ]),
      albedo: new Uint32Array([albedo]),
      nodeBounds: new Float32Array(bounds),
      nodeChildren: new Uint32Array([0xff000000, 0x0101ffff, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    },
  };
}
