import * as G from '../host/graph/graph.fixture.ts';
import { surfaceOf } from '../page/surface.ts';
import type { VisPage } from './buffer.ts';

export function camera() {
  const cam = G.perspectiveCamera(55, 1, 0.1, 100);
  cam.position.z = 5;
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  return cam;
}

export function quadPages(
  material: G.GraphSurface,
  uv?: number[],
): { pages: VisPage[]; geometry: G.Geometry } {
  const geometry = new G.Geometry();
  geometry.setAttribute('position', G.floatAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  if (uv) geometry.setAttribute('uv', G.floatAttribute(uv, 2));
  geometry.setIndex(G.indices([0, 1, 2, 0, 2, 3]));
  const pages: VisPage[] = [
    {
      array: new Uint32Array([0, 1, 2]),
      attributes: geometry.attributes,
      matrix: new G.Matrix4(),
      material: surfaceOf(material),
      clusterId: '0/0/0',
    },
    {
      array: new Uint32Array([0, 2, 3]),
      attributes: geometry.attributes,
      matrix: new G.Matrix4(),
      material: surfaceOf(material),
      clusterId: '0/0/1',
    },
  ];
  return { pages, geometry };
}

export function centerId(ids: Uint32Array, width: number, height: number) {
  return ids[((height / 2) | 0) * width + ((width / 2) | 0)];
}

/** A 2×2 RGBA map sampled nearest — red, green, blue, white — its rows as stored. */
export function nearestQuadTexture() {
  const map = G.dataTexture(
    new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]),
    2,
    2,
    G.HOST_FORMAT_RGBA,
  );
  map.magFilter = G.HOST_FILTER_NEAREST;
  map.minFilter = G.HOST_FILTER_NEAREST;
  map.flipY = false;
  map.needsUpdate = true;
  return map;
}
