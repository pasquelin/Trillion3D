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

test('moved geometry joins the occupancy map, and the first still frame rebuilds it exact', () => {
  const proxy = ownedProxy(),
    cascades = createBounceCascades(proxy.bounds);
  const occupancy = createBounceOccupancy(proxy, cascades);
  const spacing = cascades.levels[0].spacing,
    cell = Math.floor(0.5 / spacing);
  // The plane rests at z = 0; its triangle is lifted five cells, still inside the map.
  const lifted = [0.5, 0.5, 5.5 * spacing, 0.5, 0.5, 5.5 * spacing];
  assert.equal(occupancy.occupied(0, cell, cell, 0), true);
  assert.equal(occupancy.occupied(0, cell, cell, 5), false);
  occupancy.moved(lifted, [1]);
  assert.equal(occupancy.occupied(0, cell, cell, 5), true, 'the new pose is scheduled at once');
  assert.equal(occupancy.occupied(0, cell, cell, 0), true, 'the old pose stays until it settles');
  assert.equal(occupancy.occupied(0, 100000, 0, 0), false, 'motion never opens every cell');
  occupancy.settle(lifted, proxy.bounds);
  assert.equal(occupancy.occupied(0, cell, cell, 0), true, 'a frame that moved does not rebuild');
  occupancy.settle(lifted, proxy.bounds);
  assert.equal(occupancy.occupied(0, cell, cell, 0), false, 'the vacated cell leaves the map');
  assert.equal(occupancy.occupied(0, cell, cell, 5), true);
});

test('geometry moved beyond the map schedules every cell until the pose settles', () => {
  const proxy = ownedProxy(),
    cascades = createBounceCascades(proxy.bounds);
  const occupancy = createBounceOccupancy(proxy, cascades);
  const far = [1000, 0.5, 0, 1000, 0.5, 0],
    extent = [0, 0, 0, 1000, 1, 0];
  cascades.replan(extent);
  occupancy.moved(far, [1]);
  assert.equal(occupancy.occupied(0, 100000, 0, 0), true, 'the stale lattice is conservative');
  occupancy.settle(far, extent);
  occupancy.settle(far, extent);
  const spacing = cascades.levels[0].spacing;
  assert.equal(occupancy.occupied(0, Math.floor(1000 / spacing), 0, 0), true);
  assert.equal(occupancy.occupied(0, Math.floor(500 / spacing), 0, 0), false, 'occupancy recovers');
  assert.equal(occupancy.occupied(0, 100000, 0, 0), false);
});
