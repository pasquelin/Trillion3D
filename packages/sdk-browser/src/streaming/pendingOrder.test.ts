// `orderPendingUrls` keeps its storage from one frame to the next (`pendingOrder.ts`): the same
// order as storage made fresh for the frame, and the sort `Array.prototype.sort` gave.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../host/graph/graph.fixture.ts';
import { orderPendingUrls, pixelScaleOf, type PriorityRecord } from './priority.ts';
import { begin, createPendingScratch, note, sortInto } from './pendingOrder.ts';
import { cameraMoteur } from '../camera/camera.fixture.ts';
import { random } from '../page/cut/cutRuleChecks.fixture.ts';

const HOSTILE = [NaN, 0, -0, Infinity, -Infinity, 1, 2];

function frame(draw: () => number, count: number, matrices: G.Matrix4[]): PriorityRecord[] {
  const pick = <T>(list: readonly T[]) => list[Math.floor(draw() * list.length)];
  const coordinate = () => (draw() - 0.5) * 40;
  return Array.from({ length: count }, (_, i) => {
    const centre = [coordinate(), coordinate(), coordinate()],
      radius = draw() * 3;
    const sphere = draw() < 0.8 ? [centre[0], centre[1], centre[2], radius] : undefined;
    return {
      url: `c${i}`,
      streamUrl: draw() < 0.7 ? `b${Math.floor(draw() * count * 0.4)}` : undefined,
      array: draw() < 0.1 ? new Uint32Array(1) : undefined,
      min: [centre[0] - radius, centre[1] - radius, centre[2] - radius],
      max: [centre[0] + radius, centre[1] + radius, centre[2] + radius],
      matrix: pick(matrices),
      lodError: draw() < 0.1 ? undefined : draw() * 2,
      sphere,
      parentError: draw() < 0.5 ? draw() * 4 : null,
      parentSphere: draw() < 0.3 ? sphere : null,
    };
  });
}

test('frames through the kept storage order as through storage made for each', () => {
  const cam = G.perspectiveCamera(55, 16 / 9, 0.1, 1000);
  cam.position.set(0, 2, 30);
  cam.updateMatrixWorld();
  const engine = cameraMoteur(cam),
    scale = pixelScaleOf(engine.projection, [1280, 720], [1, 1]);
  const draw = random(914),
    into: string[] = [];
  const matrices = Array.from({ length: 6 }, () =>
    new G.Matrix4().makeTranslation(draw() * 4, draw() * 4, draw() * 4),
  );
  // Large frames, then small ones: the storage grows, then prunes what the frames stop asking for.
  for (const count of [0, 1, 40, 900, 900, 12, 3, 0, 300, 700, 5, 64]) {
    const records = frame(draw, count, matrices);
    matrices[Math.floor(draw() * matrices.length)].makeRotationY(draw() * 6);
    const kept = orderPendingUrls(records, engine, scale, into);
    assert.equal(kept, into);
    const fresh = orderPendingUrls(records, engine, scale, [], createPendingScratch());
    assert.deepEqual(kept, fresh, `a frame of ${count}`);
  }
});

test("bundles keep their worst error, then sort as the engine's sort did, NaN included", () => {
  const draw = random(18);
  const value = () => (draw() < 0.4 ? HOSTILE[Math.floor(draw() * HOSTILE.length)] : draw());
  const scratch = createPendingScratch();
  for (let round = 0; round < 300; round++) {
    begin(scratch);
    const slots = new Map<string, { url: string; error: number; distance: number }>();
    const count = Math.floor(draw() * 80);
    for (let i = 0; i < count; i++) {
      const url = `b${Math.floor(draw() * 40)}`,
        error = value(),
        distance = value();
      note(scratch, url, error, distance);
      const held = slots.get(url);
      if (!held) slots.set(url, { url, error, distance });
      else if (error > held.error || (error === held.error && distance < held.distance))
        Object.assign(held, { error, distance });
    }
    const expected = [...slots.values()]
      .sort((a, b) => b.error - a.error || a.distance - b.distance)
      .map((slot) => slot.url);
    assert.deepEqual(sortInto(scratch, []), expected, `round ${round}`);
  }
});

test('a frame no larger than an earlier one writes into the arrays already there', () => {
  const cam = G.perspectiveCamera(55, 1, 0.1, 1000);
  cam.position.set(0, 0, 30);
  cam.updateMatrixWorld();
  const engine = cameraMoteur(cam),
    scale = [640, 640];
  const draw = random(7),
    matrices = [new G.Matrix4(), new G.Matrix4().makeTranslation(1, 0, 0)];
  const scratch = createPendingScratch(),
    into: string[] = [];
  orderPendingUrls(frame(draw, 400, matrices), engine, scale, into, scratch);
  const { errors, distances, order, merge, views, stretches } = scratch;
  const view = views[0];
  for (const count of [400, 120, 1]) {
    const result = orderPendingUrls(frame(draw, count, matrices), engine, scale, into, scratch);
    assert.equal(result, into);
    for (const [held, now] of [
      [errors, scratch.errors],
      [distances, scratch.distances],
      [order, scratch.order],
      [merge, scratch.merge],
      [stretches, scratch.stretches],
      [view, scratch.views[0]],
    ])
      assert.equal(now, held, `a frame of ${count}`);
  }
});
