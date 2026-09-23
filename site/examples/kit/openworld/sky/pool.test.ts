import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPool, spawn, step, type Forces } from './pool.ts';
import { launch } from './particles.ts';
import { PRESETS } from './presets.ts';
import { random } from './random.ts';

const still: Forces = { lift: -9.81, drag: 0, wind: { x: 0, z: 0 } };
const none = { radius: 0, rate: 0 };

describe('particle pool', () => {
  it('never holds more than its capacity: a spawn past it is dropped', () => {
    const pool = createPool(4);
    const results = Array.from({ length: 6 }, () => spawn(pool, [0, 0, 0], [0, 0, 0], 1, 0));
    assert.deepEqual(results, [true, true, true, true, false, false]);
    assert.equal(pool.alive, 4);
  });

  it('retires particles past their life and packs the survivors at the front', () => {
    const pool = createPool(8);
    for (let i = 0; i < 6; i++) spawn(pool, [i, 0, 0], [0, 0, 0], i % 2 ? 1 : 3, 0);
    step(pool, 2, 'ballistic', still, none);
    assert.equal(pool.alive, 3);
    const survivors = [0, 1, 2].map((i) => pool.position[i * 3]).sort();
    assert.deepEqual(survivors, [0, 2, 4]);
  });

  it('recycles its slots: an emitter running for minutes stays inside the capacity', () => {
    const pool = createPool(50);
    let dropped = 0;
    for (let frame = 0; frame < 60 * 120; frame++) {
      for (let k = 0; k < 2; k++) if (!spawn(pool, [0, 0, 0], [0, 1, 0], 0.5, 0)) dropped++;
      step(pool, 1 / 60, 'ballistic', still, none);
      assert.ok(pool.alive <= 50);
    }
    // Two per frame living half a second would be 60 alive: the pool drops the excess and
    // keeps running at its capacity, slots freed by the dead taken again.
    assert.ok(dropped > 0);
    assert.ok(pool.alive > 40);
  });

  it('falls at the terminal speed lift / drag and drifts with the wind', () => {
    const pool = createPool(1);
    spawn(pool, [0, 100, 0], [0, 0, 0], 100, 0);
    const air: Forces = { lift: -9.81, drag: 1 / 0.1, wind: { x: 3, z: 0 } };
    for (let i = 0; i < 600; i++) step(pool, 1 / 60, 'ballistic', air, none);
    assert.ok(Math.abs(pool.velocity[1] + 0.981) < 0.05, `fall ${pool.velocity[1]}`);
    assert.ok(Math.abs(pool.velocity[0] - 3) < 1e-3);
  });

  it('circles its origin at the orbit radius', () => {
    const pool = createPool(1);
    spawn(pool, [10, 0, 10], [0, 0, 0], 100, 0.3);
    step(pool, 7, 'orbit', still, { radius: 50, rate: 0.2 });
    const dx = pool.position[0] - 10;
    const dz = pool.position[2] - 10;
    assert.ok(Math.abs(Math.hypot(dx, dz) - 50) < 1e-3);
  });

  it('launches the same particles from the same seed', () => {
    const run = () => {
      const next = random(332);
      return Array.from({ length: 5 }, () => launch(PRESETS.fountain, next));
    };
    assert.deepEqual(run(), run());
    for (const v of run()) assert.ok(v[1] > 0);
  });
});
