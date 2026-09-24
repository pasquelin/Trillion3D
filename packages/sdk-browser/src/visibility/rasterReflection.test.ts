// Defect 10: under a negative-determinant transform, the CPU visbuffer rasterizer kept the
// face that every other path drops — WebGPU pipelines via the `frontFace` that `windingCw`
// inverts, Three in WebGL via `frontFaceCW = determinant() < 0`, its own shading
// (`visibilityLighting`) via the sign of `face`. It therefore drew exactly the faces that
// cone rejection drops, which was read as a cone defect.
//
// Two opposite-winding triangles, placed in the plane z = 0 and separated on screen: the
// reflection `scale(1,1,-1)` leaves them in the same place and only changes orientation. The
// shown face must then flip from one to the other, for a front material as for a back one.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../host/graph/graph.fixture.ts';
import { rasterVisibility } from './raster.ts';
import { unpackVisibilityId, type VisPage } from './types.ts';
import { matrixWindingCw } from '../../../sdk-core/src/index.ts';
import { cameraMoteur } from '../camera/camera.fixture.ts';
import { surfaceOf } from '../page/surface.ts';

const VUE: [number, number] = [96, 96];
// Left: front winding. Right: reverse winding. Same area, same height, no overlap.
const POSITIONS = [-2, -1, 0, -0.5, -1, 0, -1.25, 1, 0, 0.5, -1, 0, 1.25, 1, 0, 2, -1, 0];

function page(matrix: G.Matrix4, side: number): VisPage {
  const geometrie = new G.GraphGeometry();
  geometrie.setAttribute('position', G.floatAttribute(POSITIONS, 3));
  return {
    array: new Uint32Array([0, 1, 2, 3, 4, 5]),
    attributes: geometrie.attributes,
    matrix,
    material: surfaceOf(G.basicSurface({ side })),
  };
}

function camera() {
  const cam = G.perspectiveCamera(60, 1, 0.1, 100);
  cam.position.set(0, 0, 5);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  return cam;
}

/** Triangles actually written into the buffer, and how many pixels each covers. */
function trianglesDessines(matrix: G.Matrix4, side: number) {
  const { ids } = rasterVisibility([page(matrix, side)], cameraMoteur(camera()), VUE);
  const pixels = new Map<number, number>();
  for (const identifiant of ids) {
    const lu = unpackVisibilityId(identifiant);
    if (lu) pixels.set(lu.triangleIndex, (pixels.get(lu.triangleIndex) ?? 0) + 1);
  }
  return pixels;
}

const DIRECTE = new G.Matrix4();
const REFLEXION = new G.Matrix4().makeScale(1, 1, -1);

test('the reflection is the one the engine recognises, the direct transform is not', () => {
  assert.equal(matrixWindingCw(DIRECTE.elements), false);
  assert.equal(matrixWindingCw(REFLEXION.elements), true);
});

test('without reflection, the shown face is the pre-batch one: triangle 0 for front', () => {
  const face = trianglesDessines(DIRECTE, G.FRONT_SIDE);
  assert.deepEqual([...face.keys()], [0], 'front material: only the direct triangle is written');
  assert.ok((face.get(0) ?? 0) > 100, `expected coverage, saw ${face.get(0)}`);
  const dos = trianglesDessines(DIRECTE, G.BACK_SIDE);
  assert.deepEqual([...dos.keys()], [1], 'back material: only the reverse triangle is written');
});

test('under reflection, the dropped face is the other one, as for WebGPU pipelines', () => {
  const face = trianglesDessines(REFLEXION, G.FRONT_SIDE);
  assert.deepEqual(
    [...face.keys()],
    [1],
    'reflection swaps the shown face; without that the cone dropped what the CPU drew',
  );
  const dos = trianglesDessines(REFLEXION, G.BACK_SIDE);
  assert.deepEqual([...dos.keys()], [0], 'and it swaps it for a back material too');
});

test('reflection only changes the face choice, never the coverage', () => {
  const directe = trianglesDessines(DIRECTE, G.FRONT_SIDE);
  const reflechie = trianglesDessines(REFLEXION, G.FRONT_SIDE);
  assert.equal(
    directe.get(0),
    reflechie.get(1),
    'the two triangles overlap on screen: same pixel count on both sides',
  );
});

test('a double-sided material ignores reflection and keeps both triangles', () => {
  for (const matrix of [DIRECTE, REFLEXION])
    assert.deepEqual(
      [...trianglesDessines(matrix, G.DOUBLE_SIDE).keys()].sort(),
      [0, 1],
      'no face is dropped, with or without reflection',
    );
});
