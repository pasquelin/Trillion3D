// The lit triangle rig the WebGL cluster renderer proof shares: one batch record with a real,
// still posable matrix, and the helper that moves it and its light together for the directional
// translation proof.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import * as host from '../../../packages/sdk-browser/src/camera/world.ts';
import { drawMatrix } from './webglClusterPixels.ts';

/** One triangle, basic-lit, as a `ClusterDrawMesh` batch record; its material kept apart, typed,
 *  since the record's field is the public `Material | Material[]` union. */
export const triangle = () => {
  const geometry = new G.GraphGeometry();
  geometry.setAttribute(
    'position',
    new G.BufferAttribute(new Float32Array([-1, -1, -2, 1, -1, -2, 0, 1, -2]), 3),
  );
  geometry.setAttribute('uv', new G.BufferAttribute(new Float32Array([0, 0, 1, 0, 0.5, 1]), 2));
  geometry.setAttribute(
    'normal',
    new G.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3),
  );
  geometry.setIndex(new G.BufferAttribute(new Uint32Array([0, 1, 2]), 1));
  const index = geometry.index;
  if (!index) throw new Error('triangle rig requires an indexed geometry');
  const material = G.basicSurface();
  (material.color as G.Color).setRGB(0.18, 0, 0);
  return {
    material,
    geometry,
    mesh: {
      geometry: { index, attributes: geometry.attributes },
      material: material as G.GraphSurface | G.GraphSurface[],
      renderOrder: 0,
      polygonOffsetUnits: undefined,
      matrix: drawMatrix(),
      _multiDrawCounts: new Int32Array([3]),
      _multiDrawStarts: new Int32Array([0]),
      _multiDrawCount: 1,
    },
  };
};
export type TriangleMesh = ReturnType<typeof triangle>['mesh'];

/** Moves the mesh and a directional light together, camera and light pose in step, so a
 *  translated-light image stays comparable to the untranslated one. */
export const placeRig = (
  mesh: TriangleMesh,
  camera: host.HostCamera,
  light: G.GraphLight,
  drawCamera: host.HostDrawCamera,
  offset: number,
) => {
  mesh.matrix.makeTranslation(offset, offset, offset);
  camera.position.set(offset, offset, offset);
  light.position.set(offset, offset, offset + 1);
  light.target!.position.set(offset, offset, offset);
  if (!light.parent) throw new Error('light missing parent');
  light.parent.updateMatrixWorld(true);
  host.readHostDrawCamera(drawCamera, camera);
};
