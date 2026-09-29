// #1016: the bench street is read off the model, never a share of its box assumed open. Two
// layouts: a courtyard open at its centre, and a street along one side of a covered hall.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickStreet, streetOf, streetProbe, type ColumnProbe } from './street.ts';

const bounds = { min: { x: -10, y: 0, z: -10 }, max: { x: 10, y: 8, z: 10 } };
const column = (x: number, z: number, open: boolean, clearance: number): ColumnProbe => ({
  x,
  z,
  ground: 0,
  open,
  clearance,
  known: true,
});

test('the courtyard: the roomiest floor column under open sky, never a roof, the nearer the centre between equals', () => {
  const probes = [
    column(0, 0, true, 6),
    column(2, 0, true, 6),
    column(8, 8, true, 1),
    column(5, 0, false, 9),
    { ...column(-6, 6, true, 8), ground: 7.5 },
  ];
  assert.deepEqual(pickStreet(probes, bounds), { x: 0, z: 0, ground: 0, clearance: 6 });
});

test('the covered hall: its centre has no sky, the street along its side is taken', () => {
  const probes = [column(0, 0, false, 9), column(-8, 3, true, 2), column(-8, -6, true, 1.5)];
  assert.deepEqual(pickStreet(probes, bounds), { x: -8, z: 3, ground: 0, clearance: 2 });
  assert.equal(pickStreet([column(0, 0, false, 9)], bounds), null, 'no sky anywhere');
});

test('the probe covers the footprint in a grid whose middle column is the box centre', () => {
  const probe = streetProbe(bounds, { sdkUrl: 'sdk', manifestUrl: 'manifest' });
  const side = Math.sqrt(probe.columns.length);
  assert.ok(Number.isInteger(side) && side % 2 === 1);
  assert.deepEqual(probe.columns[(probe.columns.length - 1) / 2].slice(0, 2), [0, 0]);
  assert.ok(probe.columns.every(([x, z]) => Math.abs(x) < 10 && Math.abs(z) < 10));
  assert.ok(probe.top > bounds.max.y && probe.height > bounds.max.y - bounds.min.y);
});

test('a column the physics answered nothing about is unknown, never the street', () => {
  const unloaded = { ...column(0, 0, true, 14), known: false };
  assert.deepEqual(pickStreet([unloaded, column(6, 6, true, 2)], bounds), {
    x: 6,
    z: 6,
    ground: 0,
    clearance: 2,
  });
  assert.equal(pickStreet([unloaded], bounds), null);
});

test('with no wall in reach, a column looks no farther than the box side nearest it', () => {
  const slab = { min: { x: -400, y: 0, z: -300 }, max: { x: 400, y: 4, z: 300 } };
  for (const [x, z, reach] of streetProbe(slab, { sdkUrl: 's', manifestUrl: 'm' }).columns) {
    assert.ok(reach > 0, `${x}, ${z}`);
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const [px, pz] = [x + dx * reach, z + dz * reach];
      assert.ok(px >= -400 && px <= 400 && pz >= -300 && pz <= 300, `${x}, ${z} reaches out`);
    }
  }
});

test('a model with no street to probe says why by name and walks its box', () => {
  const none = streetOf(bounds, { probes: [], noStreet: 'no physics.json beside m' });
  assert.equal(none.street, null);
  assert.equal(none.noStreet, 'no physics.json beside m');
  const roofed = streetOf(bounds, { probes: [column(0, 0, false, 9)], noStreet: null });
  assert.equal(roofed.noStreet, 'no open floor column');
  const found = streetOf(bounds, { probes: [column(0, 0, true, 3)], noStreet: null });
  assert.equal(found.noStreet, undefined);
  assert.equal(found.street?.clearance, 3);
});
