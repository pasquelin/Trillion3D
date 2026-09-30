import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../host/graph/graph.fixture.ts';
import { applyTemporalHiz, type TemporalHizState } from './hiz.ts';
import { cameraAt, quad } from '../../../../tests/fixtures/hiz.ts';
import { cameraMoteur } from '../camera/camera.fixture.ts';
import { locatedBy } from '../page/selection/placements.fixture.ts';
import type { Placements } from '../page/selection/placements.ts';

const engineCamera = cameraMoteur;

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
    cam = engineCamera(cameraAt(5)),
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
