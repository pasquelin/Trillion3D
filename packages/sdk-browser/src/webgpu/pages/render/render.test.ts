// A10: `renderWebgpuPages` copies the Hi-Z comparison view (`run.previousHizView`) into the same
// kept engine camera instead of allocating one per view change. `sameHizView` reads only the view
// and the projection, so copying into an already-allocated structure must yield exactly the same
// verdict, image after image, as a fresh structure.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { sameHizView } from '../../../hiz/hiz.ts';
import { invalidateOccluderHistory, invalidateTemporalPyramid } from '../io/drops.ts';
import {
  createEngineCamera,
  holdCameraWorld,
  readCameraWorld,
  type EngineCamera,
} from '../../../camera/world.ts';
import { cameraMoteur } from '../../../camera/camera.fixture.ts';
import { moveRootRows } from './movedRoot.ts';
import { createWebgpuRowState } from '../../row/state.ts';
import { createBoxCorners } from '../../../hiz/hiz.ts';
import { PAGE_INFO_STRIDE } from '../../../visibility/buffer.ts';
import type { ClusterRoot, PageRec } from '../../../page/selection/types.ts';

function poses(n: number) {
  const cams: THREE.PerspectiveCamera[] = [];
  for (let i = 0; i < n; i++) {
    const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 200);
    cam.position.set(Math.sin(i * 0.7) * 3, 0, 6 + i * 0.001);
    if (i % 5 === 0) cam.fov = 40 + i; // occasional projection change
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    cams.push(cam);
  }
  return cams;
}

test('copying a view into a kept engine camera matches a fresh one, verdict for verdict', () => {
  const frames = poses(50);
  let neuve: EngineCamera | undefined;
  let gardee: EngineCamera | undefined;
  for (const frame of frames) {
    const courante = cameraMoteur(frame);
    const viaNeuve = sameHizView(neuve, courante);
    neuve = holdCameraWorld(createEngineCamera(), courante);
    const viaCopie = sameHizView(gardee, courante);
    gardee = holdCameraWorld(gardee ?? createEngineCamera(), courante);
    assert.equal(viaCopie, viaNeuve, 'same-image verdict must not depend on a fresh structure');
  }
});

test('the kept camera is the same object across frames: never reallocated, never left undefined', () => {
  const frames = poses(3);
  let kept: EngineCamera | undefined;
  const identities = new Set<EngineCamera>();
  for (const frame of frames) {
    const courante = cameraMoteur(frame);
    sameHizView(kept, courante);
    kept = holdCameraWorld(kept ?? createEngineCamera(), courante);
    identities.add(kept);
  }
  assert.equal(identities.size, 1, 'the same camera instance is reused across every frame');
});

test('a repeated identical pose is stable, and NaN in the world matrix never reports a false match', () => {
  const a = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  a.position.z = 5;
  a.lookAt(0, 0, 0);
  a.updateMatrixWorld();
  const kept = holdCameraWorld(createEngineCamera(), cameraMoteur(a));
  assert.equal(sameHizView(kept, cameraMoteur(a)), true);
  // The kept camera is frozen; THIS image's is copied from the host, which inverts its world matrix:
  // a NaN must enter through the local pose, not by touching the numbers by hand, or it would be
  // rewritten before the comparison.
  const nanCam = a.clone();
  nanCam.position.x = NaN;
  assert.equal(
    sameHizView(kept, readCameraWorld(createEngineCamera(), nanCam)),
    false,
    'NaN never compares equal to itself',
  );
});

// "Occluder history" lever: a moving camera only voids the temporal pyramid. The two invalidations
// are of different kinds — the pyramid is reread only for a bit-identical view, occluder history
// names pages only — and therefore split.
function runState() {
  return {
    noOccluderHistory: false,
    temporalHizState: { pyramid: {}, camera: {} },
  } as unknown as Parameters<typeof invalidateTemporalPyramid>[0];
}

test('invalidateTemporalPyramid drops the pyramid and keeps the occluder history', () => {
  const run = runState();
  invalidateTemporalPyramid(run);
  assert.equal(run.temporalHizState.pyramid, undefined);
  assert.equal(run.temporalHizState.camera, undefined);
  assert.equal(run.noOccluderHistory, false, 'the pages drawn last image still describe this one');
});

test('invalidateOccluderHistory still drops both', () => {
  const run = runState();
  invalidateOccluderHistory(run);
  assert.equal(run.temporalHizState.pyramid, undefined);
  assert.equal(run.temporalHizState.camera, undefined);
  assert.equal(run.noOccluderHistory, true);
});

// A moved model rewrites its own rows, not the scene's (#358). The table's age used to advance on
// every move: every row, every corner and every transparent corner written again, and the whole
// scene's occlusion history dropped, each image a model moved.
const ROW_WORDS = PAGE_INFO_STRIDE / 4;

/** A root of `count` clusters, all placed by the same world. */
function root(name: string, count: number, transparent = false): ClusterRoot<PageRec> {
  const world = { elements: new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) };
  const pages = Array.from(
    { length: count },
    (_, i) =>
      ({ url: `${name}${i}`, matrix: world, transparent, windingEpoch: 1 }) as unknown as PageRec,
  );
  return { world, pages };
}

/** A terrain of `terrain` rows, then a model of `model` rows, every cluster resident. */
function scene(terrain: number, model: number) {
  const ground = root('t', terrain),
    moving = root('m', model),
    glass = root('g', 2, true);
  const pages = [...ground.pages, ...moving.pages, ...glass.pages];
  const rows = createWebgpuRowState(pages, terrain + model);
  rows.pageTableFloats = new Float32Array((terrain + model) * ROW_WORDS);
  for (let row = 0; row < terrain + model; row++) {
    rows.rowOfPage[row] = row;
    rows.packedPageIndex[row] = row;
  }
  rows.packedCount = terrain + model;
  const run = {
    noOccluderHistory: false,
    temporalHizState: { pyramid: {}, camera: {} },
  } as unknown as Parameters<typeof moveRootRows>[0]['run'];
  const boxCorners = createBoxCorners(pages.length);
  boxCorners.epoch.fill(1);
  const rt = { layout: { rows, boxCorners }, run, blendState: { occlusionEpoch: 1 } };
  return { rt, rows, run, boxCorners, moving, glass };
}

test('a model of N rows moved in a scene of M rows rewrites N rows', () => {
  const terrain = 900,
    model = 12;
  const { rt, rows, run, boxCorners, moving } = scene(terrain, model);
  const before = rows.pageTableFloats!.slice();
  (moving.world.elements as Float64Array)[12] = 3;
  assert.equal(moveRootRows(rt, moving), model);
  // The table travels for the model's rows alone, and keeps its age.
  assert.equal(rows.dirtyFrom, terrain);
  assert.equal(rows.dirtyTo, terrain + model - 1);
  assert.equal(rows.tableEpoch, 1);
  const after = rows.pageTableFloats!;
  for (let row = 0; row < terrain + model; row++) {
    const base = row * ROW_WORDS,
      moved = row >= terrain;
    assert.equal(after[base + 12], moved ? 3 : 0, `row ${row}: its world translation`);
    if (!moved)
      assert.deepEqual(
        after.subarray(base, base + ROW_WORDS),
        before.subarray(base, base + ROW_WORDS),
      );
  }
  // Their corners and windings are computed again; the terrain keeps its own, and the scene its
  // occlusion history. The temporal pyramid, one image of the whole scene, is dropped.
  assert.equal(boxCorners.epoch[terrain], -1);
  assert.equal(boxCorners.epoch[0], 1);
  assert.equal(moving.pages[0].windingEpoch, undefined);
  assert.equal(run.noOccluderHistory, false);
  assert.equal(run.temporalHizState.pyramid, undefined);
  assert.equal(rt.blendState.occlusionEpoch, 1, 'no transparent cluster moved');
});

test('a transparent model claims no row: its corners are sent again, no row is', () => {
  const { rt, rows, glass } = scene(4, 2);
  assert.equal(moveRootRows(rt, glass), 0);
  assert.equal(rows.dirtyTo, -1);
  assert.equal(rt.blendState.occlusionEpoch, -1);
});
