// The view AHEAD of a moving camera (#488): the cut requests the pages the camera is about to need
// before they are on screen, below every visible request, and a still camera cuts as before. Proven
// on the oracle, the kernel's bit-for-bit mirror (`oracle/oracle.fixture.ts`, `shader/aheadWgsl.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { packDagSelection } from './selection.ts';
import { scenePages, sceneRoots } from './cutFrontierScene.fixture.ts';
import { VIEWPORT } from './selectionHelpers.fixture.ts';
import { cameraSelectionUniforms } from '../core/selection.ts';
import { engineCamera } from '../../camera/camera.fixture.ts';
import { readCameraMotion, type CameraMotion } from '../../camera/motion.ts';
import { PREFETCH_HORIZON_MS } from '../../backend/common.ts';
import { restartCameraMotion } from '../../camera/motion.fixture.ts';
import { evaluateDagSelectionKernel } from './oracle/oracle.fixture.ts';
import { packedWorldsToRenderOrigin } from './pack.fixture.ts';

const SPEED = 40,
  HORIZON = PREFETCH_HORIZON_MS / 1000,
  /** Turn rate of the turning camera, radians per second. */
  TURN = 2;

/** Three copies of a detail pyramid, six units wide, at `(x, 0, z)` of `at`: by default along x,
 *  twenty units apart, and the camera sees only the first. */
function scene(at = [0, 20, 40].map((x) => [x, 0])) {
  const pages = scenePages(1024, 6);
  const roots = sceneRoots(
    pages,
    at.map(([x, z]) => new G.Matrix4().makeTranslation(x, 0, z)),
    true,
  );
  return { pages, roots, packed: packDagSelection(roots) };
}

/** The engine camera ten units above the pyramids at `x`, looking down -z turned by `yaw` radians. */
function cameraAt(x: number, yaw = 0) {
  const camera = G.perspectiveCamera(55, 16 / 9, 0.1, 200);
  camera.position.set(x, 0, 10);
  camera.lookAt(x + 10 * Math.tan(yaw), 0, 0);
  camera.updateMatrixWorld(true);
  return engineCamera(camera);
}

/** The cut of the camera at `x` and `yaw`, moving along +x at `speed` and turning at `turn` rad/s
 *  steadily over the last horizon, a frame every 50 ms: the view ahead extrapolates it whole. */
function cut(s: ReturnType<typeof scene>, x: number, speed: number, yaw = 0, turn = 0) {
  const motion: CameraMotion = {};
  for (let t = -PREFETCH_HORIZON_MS; t < 0; t += 50)
    readCameraMotion(cameraAt(x + (speed * t) / 1000, yaw + (turn * t) / 1000), motion, t);
  const cam = cameraAt(x, yaw);
  readCameraMotion(cam, motion, 0);
  const uniforms = cameraSelectionUniforms(cam, 1, VIEWPORT, undefined, motion);
  packedWorldsToRenderOrigin(s.packed, s.roots, uniforms.cameraWorld);
  return { uniforms, result: evaluateDagSelectionKernel(s.packed, uniforms) };
}

const worldOf = (s: ReturnType<typeof scene>, id: number) => Math.floor(id / s.pages.length);

test('a camera at constant velocity requests its view ahead before it is visible', () => {
  const s = scene();
  const now = cut(s, 0, SPEED).result;
  // Where the camera will be at the horizon, still moving: what it then sees.
  const later = cut(s, SPEED * HORIZON, SPEED).result;
  const seenLater = later.pageIds.filter((id) => worldOf(s, id) === 1);
  assert.ok(seenLater.length > 20, 'the second pyramid enters the view at the horizon');
  assert.equal(now.pageIds.filter((id) => worldOf(s, id) === 1).length, 0, 'it is not visible yet');
  const ahead = new Set(now.aheadPageIds);
  const missed = seenLater.filter((id) => !ahead.has(id));
  assert.deepEqual(missed, [], 'every page it will show was requested ahead');
  assert.equal(
    now.aheadPageIds!.filter((id) => worldOf(s, id) === 2).length,
    0,
    'and nothing past the horizon',
  );
});

test('a camera turning in place requests the view it turns to before it is visible', () => {
  const s = scene();
  const now = cut(s, 0, 0, 0.1, TURN).result;
  // What the camera sees once it has turned over the horizon, still turning.
  const later = cut(s, 0, 0, 0.1 + TURN * HORIZON, TURN).result;
  const seenLater = later.pageIds.filter((id) => worldOf(s, id) === 1);
  assert.ok(seenLater.length > 20, 'the second pyramid enters the view it turns to');
  assert.equal(now.pageIds.filter((id) => worldOf(s, id) === 1).length, 0, 'not visible yet');
  const ahead = new Set(now.aheadPageIds);
  assert.deepEqual(
    seenLater.filter((id) => !ahead.has(id)),
    [],
    'every page it will show was requested ahead',
  );
});

test('requests ahead are served by when the camera needs them, the soonest first', () => {
  // Moving along +x from x = -1, the camera reaches the third pyramid, far below, within the first
  // fifth of the horizon, and the second, near, only in its last eighth. Their errors rank alike: by
  // error alone, the second would come first.
  const s = scene([
    [0, 0],
    [20, 0],
    [22.5, -10],
  ]);
  const { result } = cut(s, -1, SPEED);
  assert.equal(result.pageIds.filter((id) => worldOf(s, id) > 0).length, 0, 'neither is visible');
  const order = result.aheadPageIds!.map((id) => worldOf(s, id));
  assert.ok(order.includes(1) && order.includes(2), 'both are asked for ahead');
  assert.equal(order[0], 2, 'the sooner one first');
  assert.ok(order.lastIndexOf(2) < order.indexOf(1), 'every page of it');
});

test('every visible request comes before every request ahead, which never repeats one', () => {
  const s = scene();
  const { result } = cut(s, 0, SPEED);
  assert.ok(result.pageIds.length > 20 && result.aheadPageIds!.length > 20);
  const visible = new Set(result.pageIds);
  assert.equal(result.aheadPageIds!.filter((id) => visible.has(id)).length, 0);
  // The oracle's priorities rank the visible tier alone; the tier ahead is a list of its own that
  // the host serves after it (`../../webgpu/residency/lowerTier.ts`).
  assert.equal(result.requestPriorities!.length, result.pageIds.length);
});

test('a still camera sends no view ahead, and its cut is the one of before', () => {
  const s = scene();
  const { uniforms, result } = cut(s, 0, 0);
  assert.equal(uniforms.ahead, null);
  assert.deepEqual(result.aheadPageIds, []);
  const without = cameraSelectionUniforms(cameraAt(0), 1, VIEWPORT);
  assert.deepEqual(evaluateDagSelectionKernel(s.packed, without), result);
});

test('a stop keeps the view ahead’s arrays: the next move rewrites them', () => {
  const s = scene(),
    uniforms = cut(s, 0, SPEED).uniforms,
    arrays = uniforms.ahead!;
  const motion: CameraMotion = {};
  readCameraMotion(cameraAt(0), motion, 0);
  readCameraMotion(cameraAt(0), motion, 16);
  cameraSelectionUniforms(cameraAt(0), 1, VIEWPORT, uniforms, motion);
  assert.equal(uniforms.ahead, null, 'still: none sent');
  readCameraMotion(cameraAt(1), motion, 32);
  cameraSelectionUniforms(cameraAt(1), 1, VIEWPORT, uniforms, motion);
  assert.equal(uniforms.ahead, arrays, 'moving again: the same arrays');
});

test('a still camera whose way back is only rounded to unit length does not turn', () => {
  // Looking at the origin from (1, 1, 1.2): the view's way back squares to 1 - 2⁻⁵², not 1.
  const camera = G.perspectiveCamera(55, 1, 0.1, 100);
  camera.position.set(1, 1, 1.2);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const cam = engineCamera(camera),
    motion: CameraMotion = {};
  readCameraMotion(cam, motion, 0);
  readCameraMotion(cam, motion, 16);
  assert.equal(motion.turn, 0);
  assert.equal(cameraSelectionUniforms(cam, 1, [512, 512], undefined, motion).ahead, null);
});

test('a capture from another camera leaves the main camera still once its motion is restored', () => {
  // The captures save the motion as a shallow copy, restart it, draw their own camera, restore it
  // (`../../webgpu/pages/io/surfaceCapture.ts`): the main camera must not read the capture's turn.
  const main = cameraAt(0),
    motion: CameraMotion = {};
  readCameraMotion(main, motion, 0);
  readCameraMotion(main, motion, 16);
  const saved = { ...motion };
  restartCameraMotion(motion);
  readCameraMotion(cameraAt(0, 0.6), motion, 32);
  readCameraMotion(cameraAt(0, 0.6), motion, 48);
  Object.assign(motion, saved);
  readCameraMotion(main, motion, 64);
  assert.equal(motion.turn, 0);
  assert.equal(cameraSelectionUniforms(main, 1, [512, 512], undefined, motion).ahead, null);
});
