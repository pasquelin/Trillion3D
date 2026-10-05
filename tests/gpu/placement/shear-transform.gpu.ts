// `setTransform` keeps a shear (defect 2). What the engine sends the GPU to place a primitive is
// `root.world`, and the DAG selection kernel brings the frustum planes into that matrix's space.
// The kernel (`../dag/selectionKernel.ts`) runs here on one page seen by the same camera, once
// with the requested sheared matrix and once with its translation-rotation-scale recomposition —
// what `setTransform` once posed. The narrow view's verdicts differ: losing the shear was no
// approximation, it changed the selected page.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { OPEN_CONE } from '../../../packages/sdk-browser/src/page/cone/cone.ts';
import { packDagSelection } from '../../../packages/sdk-browser/src/gpu/dag/selection.ts';
import { cameraSelectionUniforms } from '../../../packages/sdk-browser/src/gpu/core/selection.ts';
import { cameraMoteur } from '../../../packages/sdk-browser/src/camera/camera.fixture.ts';
import { packedWorldsToRenderOrigin } from '../../../packages/sdk-browser/src/gpu/dag/pack.fixture.ts';
import { runSelectionKernel } from '../dag/selectionKernel.ts';

const VIEWPORT: [number, number] = [1000, 1000];
// A unit local box: sheared, it covers x ∈ [-4, 4]; recomposed as TRS, x ∈ [-2.364, 2.364].
const MIN = [-1, -1, -1],
  MAX = [1, 1, 1];

/** The requested matrix: `y` pushes `x`, two non-orthogonal axes. */
const sheared = new G.Matrix4().set(1, 3, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);

/** The same matrix reduced to a translation-rotation-scale product: what the defect posed. */
function recomposed(source: G.Matrix4) {
  const position = new G.Vector3(),
    rotation = new G.Quaternion(),
    scale = new G.Vector3();
  source.decompose(position, rotation, scale);
  return new G.Matrix4().compose(position, rotation, scale);
}

/** The selection uniforms of a view along -z centred on `x`, of vertical field `fov`. */
function view(x: number, fov: number) {
  const camera = G.perspectiveCamera(fov, 1, 0.1, 100);
  camera.position.set(x, 0, 10);
  camera.lookAt(x, 0, 0);
  camera.updateMatrixWorld(true);
  return cameraSelectionUniforms(cameraMoteur(camera), 0, VIEWPORT);
}

/** One kernel case: the page packed IN THE RENDER FRAME of its view — the eye is its origin — as
 *  the frame input carries it to the GPU; packed in absolute world under a relative view, the
 *  frustum would cut in two frames at once. */
function selectionCase(
  name: string,
  world: G.Matrix4,
  sphere: number[],
  uniforms: ReturnType<typeof view>,
) {
  const page = { url: '0', lodError: 0, parentError: null, sphere, min: MIN, max: MAX };
  const packed = packDagSelection([{ world, pages: [{ ...page, cone: OPEN_CONE }] }]);
  const roots = [{ world, pages: [] }];
  return {
    name,
    packed: packedWorldsToRenderOrigin(packed, roots, uniforms.cameraWorld),
    uniforms,
  };
}

test('the selection kernel keeps a sheared page a TRS recomposition loses', async () => {
  const approximated = recomposed(sheared);
  assert.notDeepEqual(
    Array.from(approximated.elements),
    Array.from(sheared.elements),
    'the proof needs two different matrices',
  );
  const narrow = view(3.5, 10),
    wide = view(0, 60);
  const { readings } = await runSelectionKernel([
    selectionCase('narrow sheared', sheared, [3.5, 0, 0, 1], narrow),
    selectionCase('narrow recomposed', approximated, [3.5, 0, 0, 1], narrow),
    selectionCase('wide sheared', sheared, [0, 0, 0, 5], wide),
    selectionCase('wide recomposed', approximated, [0, 0, 0, 5], wide),
  ]);
  const pages = (name: string) => readings.find((reading) => reading.name === name)?.pages;
  assert.deepEqual(pages('wide sheared'), [0], 'witness: face-on and far, the page is kept');
  assert.deepEqual(pages('wide recomposed'), [0], 'witness: the recomposed pack is sound');
  assert.deepEqual(pages('narrow sheared'), [0], 'the requested matrix carries the page in view');
  assert.deepEqual(
    pages('narrow recomposed'),
    [],
    'the TRS recomposition takes the page out of the frustum: the kernel selects otherwise',
  );
});
