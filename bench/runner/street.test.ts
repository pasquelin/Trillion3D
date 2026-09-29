// #1016: the bench street is read off the model, never a share of its box assumed open. Two
// layouts: a courtyard open at its centre, and a street along one side of a covered hall.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickStreet, streetProbe, type ColumnProbe } from './street.ts';

const bounds = { min: { x: -10, y: 0, z: -10 }, max: { x: 10, y: 8, z: 10 } };
const column = (x: number, z: number, open: boolean, clearance: number): ColumnProbe => ({
  x,
  z,
  ground: 0,
  open,
  clearance,
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
  assert.deepEqual(probe.columns[(probe.columns.length - 1) / 2], [0, 0]);
  assert.ok(probe.columns.every(([x, z]) => Math.abs(x) < 10 && Math.abs(z) < 10));
  assert.ok(probe.top > bounds.max.y && probe.height > bounds.max.y - bounds.min.y);
});
