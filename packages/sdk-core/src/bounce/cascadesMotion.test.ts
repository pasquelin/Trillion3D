import test from 'node:test';
import assert from 'node:assert/strict';
import { createBounceCascades } from './cascades.ts';
import { createBounceOccupancy } from './occupancy.ts';
import { ownedProxy } from '../scene/core/proxy.fixture.ts';

test('whole-scene translation changes cell stamps without discarding the existing lattice', () => {
  const cascades = createBounceCascades([0, 0, 0, 1, 1, 1]);
  const spacing = cascades.levels[0].spacing,
    oldBase = cascades.levels[0].base.slice();
  assert.equal(cascades.replan([20, 0, 0, 21, 1, 1]), false);
  assert.equal(cascades.invalidLevels, 0);
  assert.equal(cascades.levels[0].spacing, spacing);
  assert.notDeepEqual(cascades.levels[0].base, oldBase);
  assert.equal(cascades.probes, 4096);
  assert.equal(cascades.reserveCount, 16384);
});

test('enlarged geometry uses the same bounded cascade plan as preparing that extent', () => {
  const extent = [0, 0, 0, 1000, 1, 1];
  const cascades = createBounceCascades([0, 0, 0, 1, 1, 1]);
  assert.equal(cascades.replan(extent), true);
  assert.equal(cascades.invalidLevels, 15);
  const fresh = createBounceCascades(extent);
  assert.deepEqual(cascades.levels, fresh.levels);
  assert.equal(cascades.reach, fresh.reach);
  assert.equal(cascades.probes, cascades.reserveCount);
  assert.equal(cascades.replan(extent), false);
  assert.equal(cascades.invalidLevels, 0);
});

test('motion conservatively enables cells outside the original occupancy extent', () => {
  const proxy = ownedProxy(),
    cascades = createBounceCascades(proxy.bounds);
  const occupancy = createBounceOccupancy(proxy, cascades);
  const bytes = occupancy.bytes;
  assert.equal(occupancy.occupied(0, 100000, 0, 0), false);
  occupancy.allEligible();
  assert.equal(occupancy.occupied(0, 100000, 0, 0), true);
  assert.equal(occupancy.bytes, bytes, 'eligibility never grows storage with world extent');
});
