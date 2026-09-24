import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CommandWriter, SHAPE } from '../../../sdk-core/src/physics/index.ts';
import { body, castDown, startModule, type Module } from './module.fixture.ts';

/** The ramp 2^-12 as large (`physics_cook/small_tests.rs`): its triangles are under the area Jolt keeps,
 *  so the tile is the ramp cooked larger inside a `ScaledShape` of the inverse (#562). */
const RAMP = [0, 0, -1, 2, 1, -1, 2, 1, 1, 0, 0, 1].map((v) => v / 4096);
const RAMP_TRIANGLES = [0, 2, 1, 0, 3, 2];
/** An instance scale that is no power of two: the tile's own scale nests under it. */
const SCALE = 1000;

/** Casts down at the middle of the small ramp placed `SCALE` times larger, where its height is
 *  x / 2: the drawn surface is hit at the right place, and nothing past it. */
function hitsTheScaledRamp(jolt: Module) {
  const x = RAMP[3] * SCALE * 0.5;
  const f = new Float32Array(castDown(jolt, x).buffer);
  assert.equal(new Uint32Array(f.buffer)[0], 0, 'the ramp is hit');
  assert.ok(Math.abs(f[3] - x / 2) < 1e-5, `hit at y = ${f[3]}, drawn at ${x / 2}`);
  assert.ok(f[5] < 0 && f[6] > 0.8, 'the normal leans back along the slope');
  assert.equal(castDown(jolt, RAMP[3] * SCALE * 1.5)[0], 0xffffffff, 'past the ramp, nothing');
}

test('a tile of sub-millimetre triangles is restored whole, its scale nested under the instance scale', async () => {
  const jolt = await startModule();
  const writer = new CommandWriter();
  const small = await readFile(
    new URL('../../../../tests/fixtures/physics/small-ramp-tile.bin', import.meta.url),
  );
  writer.restore(0, new Uint8Array(small));
  writer.add({
    ...body(0, 0, 0, 1),
    shape: SHAPE.cooked,
    size: [SCALE, SCALE, SCALE],
    indices: [0],
  });
  jolt.step(writer.take(), 0);
  hitsTheScaledRamp(jolt);
});

test('a triangle mesh of sub-millimetre triangles built at run time keeps them all', async () => {
  const jolt = await startModule();
  const writer = new CommandWriter();
  writer.add({
    ...body(0, 0, 0, 1),
    shape: SHAPE.triangles,
    vertices: RAMP,
    indices: RAMP_TRIANGLES,
  });
  jolt.step(writer.take(), 0);
  const x = RAMP[3] * 0.5;
  const f = new Float32Array(castDown(jolt, x).buffer);
  assert.equal(new Uint32Array(f.buffer)[0], 0, 'the ramp is hit');
  // The ray starts 5 m up: its float step there, not the ramp, bounds the error.
  assert.ok(Math.abs(f[3] - x / 2) < 1e-6, `hit at y = ${f[3]}, drawn at ${x / 2}`);
  assert.equal(castDown(jolt, RAMP[3] * 1.5)[0], 0xffffffff, 'past the ramp, nothing');
});
