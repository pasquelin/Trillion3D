import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../host/graph/graph.fixture.ts';
import {
  HIZ_BOUNDS_VALUES,
  BOX_CORNER_VALUES,
  pageCornersInto,
  projectBoxesFlat,
  applyTemporalHiz,
  type HizPage,
  type TemporalHizState,
} from './hiz.ts';
import { splitOccludersFlat, splitOccludersInto } from './split.ts';
import { projectCornersInto } from './corners.ts';
import { cameraAt, projectBoxToScreen, quad } from '../../../../tests/fixtures/hiz.ts';
import { cameraMoteur } from '../camera/camera.fixture.ts';
import { locatedBy } from '../page/selection/placements.fixture.ts';
import type { Placements } from '../page/selection/placements.ts';

test('flat projection and split reproduce the object forms to the bit, including depth ties', () => {
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return seed / 4294967296;
  };
  const pages: (HizPage & { matrix: G.Matrix4 })[] = [];
  for (let i = 0; i < 300; i++) {
    const centre = [rnd() * 20 - 10, rnd() * 20 - 10, -rnd() * 40],
      half = [rnd() * 2 + 0.01, rnd() * 2 + 0.01, rnd() * 2 + 0.01];
    const matrix = new G.Matrix4()
      .makeRotationY(rnd() * 6)
      .setPosition(rnd() * 4 - 2, rnd() * 4 - 2, rnd() * 4 - 2);
    pages.push({
      min: centre.map((value, axis) => value - half[axis]),
      max: centre.map((value, axis) => value + half[axis]),
      matrix,
    });
  }
  // Copies of existing boxes give the sort exactly equal depths, where the index tie-break decides.
  for (let i = 0; i < 30; i++) pages.push({ ...pages[i] });
  const roots = pages.map(({ matrix }) => ({ world: matrix }));
  const camera = G.perspectiveCamera(60, 16 / 9, 0.1, 200);
  camera.position.set(1, 2, 3);
  camera.lookAt(0, 0, -20);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const viewport: [number, number] = [1280, 720],
    engine = cameraMoteur(camera);
  const flat = new Float64Array(pages.length * HIZ_BOUNDS_VALUES),
    locations = locatedBy(roots);
  projectBoxesFlat(pages, locations, pages.length, engine, viewport, flat);
  for (let i = 0; i < pages.length; i++) {
    const reference = projectBoxToScreen(
        pages[i].min,
        pages[i].max,
        pages[i].matrix,
        camera,
        viewport,
      ),
      base = i * HIZ_BOUNDS_VALUES;
    assert.equal(flat[base + 5] !== 0, reference.clipsNear);
    if (reference.clipsNear) continue;
    assert.deepEqual(
      [flat[base], flat[base + 1], flat[base + 2], flat[base + 3], flat[base + 4]],
      [reference.minX, reference.minY, reference.maxX, reference.maxY, reference.nearestDepth],
    );
  }
  // The same rectangles from the corners the GPU upload derives (`pageCornersInto`): a derived corner
  // is the same double as the one-shot path's, not a rounded one.
  const corners = new Float64Array(BOX_CORNER_VALUES),
    derived = new Float64Array(flat.length),
    { view, viewProjection, near } = engine;
  for (let i = 0; i < pages.length; i++) {
    pageCornersInto(corners, 0, pages[i], pages[i].matrix);
    const base = i * HIZ_BOUNDS_VALUES;
    projectCornersInto(corners, 0, view, viewProjection, near, ...viewport, derived, base);
  }
  assert.deepEqual([...derived], [...flat], 'rectangles from derived corners');
  const rest = new Uint8Array(pages.length),
    occluders = splitOccludersFlat(pages.length, flat, rest);
  const tagged = pages.map((page, index) => ({ ...page, tag: index }));
  const referenceOccluders: (HizPage & { tag: number })[] = [],
    referenceRest: (HizPage & { tag: number })[] = [];
  splitOccludersInto(
    tagged,
    locations,
    engine,
    viewport,
    referenceOccluders,
    referenceRest,
    [],
    [],
  );
  assert.equal(occluders, referenceOccluders.length);
  assert.equal(referenceOccluders.length + referenceRest.length, tagged.length);
  const referenceOccluderTags = new Set(referenceOccluders.map((page) => page.tag));
  for (let i = 0; i < pages.length; i++)
    assert.equal(rest[i] === 0, referenceOccluderTags.has(i), `page ${i}`);
});

test('temporal Hi-Z keeps or rejects each placement of a shared record on its own (#1235)', () => {
  const wallMat = G.basicSurface({ color: 0xff0000 });
  const propMat = G.basicSurface({ color: 0x00ff00 });
  const wall = quad(wallMat, [-1, -1, 0], [1, 1, 0], 'wall');
  const prop = quad(propMat, [-0.2, -0.2, 0], [0.2, 0.2, 0], 'prop');
  const back = quad(propMat, [-0.3, -0.3, -3], [0.3, 0.3, -3], 'back');
  // One record, two placements: one before the wall, one hidden behind it. A second page hidden
  // behind the wall keeps the history's split from falling back to depth order.
  const roots = [
    { world: new G.Matrix4() },
    { world: new G.Matrix4().makeTranslation(0, 0, 1) },
    { world: new G.Matrix4().makeTranslation(0, 0, -2) },
    { world: new G.Matrix4() },
  ] as unknown as Placements;
  const selected = [wall.page, prop.page, prop.page, back.page],
    locations = locatedBy(roots),
    cam = cameraMoteur(cameraAt(5)),
    size: [number, number] = [32, 32],
    history: TemporalHizState = {};
  const first = applyTemporalHiz(selected, locations, cam, size, history);
  assert.deepEqual([...first.shownPacked].sort(), [0, 1]);
  // The same view again: the history keeps the front placement, never the hidden one with it.
  const second = applyTemporalHiz(selected, locations, cam, size, history);
  assert.deepEqual([...second.shownPacked].sort(), [0, 1], 'the hidden placement stays culled');
  assert.equal(second.hizRejected, 2);
  for (const made of [wall, prop, back]) made.geometry.dispose();
  wallMat.dispose();
  propMat.dispose();
});
