// The view AHEAD of a moving camera (#488): the cut requests the pages the camera is about to need
// before they are on screen, below every visible request, and a still camera cuts as before. Proven
// on the oracle, the kernel's bit-for-bit mirror (`oracle/oracle.ts`, `shader/aheadWgsl.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import {
  evaluateDagSelectionKernel,
  packDagSelection,
  packedWorldsToRenderOrigin,
} from './selection.ts';
import { scenePages, sceneRoots } from './cutFrontierScene.fixture.ts';
import { cameraSelectionUniforms } from '../core/selection.ts';
import { cameraMoteur } from '../../camera/camera.fixture.ts';
import { readCameraMotion, type CameraMotion } from '../../camera/motion.ts';
import { PREFETCH_HORIZON_MS } from '../../backend/common.ts';

const SPEED = 40,
  HORIZON = PREFETCH_HORIZON_MS / 1000;

/** Three copies of a detail pyramid along x, twenty units apart: the camera sees only the first. */
function scene() {
  const pages = scenePages(1024, 6);
  const roots = sceneRoots(
    pages,
    [0, 20, 40].map((x) => new G.Matrix4().makeTranslation(x, 0, 0)),
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
  return cameraMoteur(camera);
}

/** The cut of the camera at `x`, moving along +x at `speed` over the last tenth of a second. */
function cut(s: ReturnType<typeof scene>, x: number, speed: number) {
  const motion: CameraMotion = {};
  readCameraMotion(cameraAt(x - speed * 0.1), motion, 0);
  const cam = cameraAt(x);
  readCameraMotion(cam, motion, 100);
  const uniforms = cameraSelectionUniforms(cam, 1, [1280, 720], undefined, motion);
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
  const without = cameraSelectionUniforms(cameraAt(0), 1, [1280, 720]);
  assert.deepEqual(evaluateDagSelectionKernel(s.packed, without), result);
});

test('a still camera whose way back is only rounded to unit length does not turn', () => {
  // Looking at the origin from (1, 1, 1.2): the view's way back squares to 1 - 2⁻⁵², not 1.
  const camera = G.perspectiveCamera(55, 1, 0.1, 100);
  camera.position.set(1, 1, 1.2);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const cam = cameraMoteur(camera),
    motion: CameraMotion = {};
  readCameraMotion(cam, motion, 0);
  readCameraMotion(cam, motion, 16);
  assert.equal(motion.turn, 0);
  assert.equal(cameraSelectionUniforms(cam, 1, [512, 512], undefined, motion).ahead, null);
});
