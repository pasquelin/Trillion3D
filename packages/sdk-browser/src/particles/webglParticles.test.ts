// The CPU half of the WebGL2 particle step (#759): the texels, uniforms and targets it hands its
// GPU for a pool, and its refusal without 32-bit float targets. The GPU's part is the measurer's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ParticlePool } from '../../../sdk-core/src/fluids/particles.ts';
import { webgl, webglModel } from './stepModels.fixture.ts';

const DT = 1 / 64;

test('WebGL2: the records land as float texels, only emitted rows are drawn, the targets swap', () => {
  const { ctx, run } = webgl();
  const pool = new ParticlePool({ capacity: 2000, emitPerFrame: 1000 });
  for (let i = 0; i < 600; i++) pool.emit(i, 1, 2, 3, 4, 5, 6);
  pool.advance(0.01);
  const first = run([pool]);
  assert.equal(first.draws, 1);
  // 512 records a row, two texels each: one whole row, then 88 records on the second.
  assert.deepEqual(
    first.of('texSubImage2D').map(([, , x, y, w, h, , , , offset]) => [x, y, w, h, offset]),
    [
      [0, 0, 1024, 1, 0],
      [0, 1, 176, 1, 512 * 8],
    ],
  );
  assert.equal(first.of('texSubImage2D')[0][8], pool.staging, 'straight from the staging');
  assert.deepEqual(first.of('uniform4f')[0].slice(1), [0, Math.fround(-9.81), 0, 0.01]);
  assert.deepEqual(first.of('uniform3i')[0].slice(1), [0, 600, 2000], 'first slot, count, ring');
  assert.deepEqual(first.of('viewport').at(-1), [0, 0, 1024, 2], '600 slots: 2 of 4 rows');
  const into = (step: typeof first) => step.of('bindFramebuffer').findLast(([, fb]) => fb)?.[1];
  pool.advance(0.01);
  const second = run([pool]);
  assert.notEqual(into(second), into(first), 'the other target is written');
  assert.deepEqual(second.of('uniform3i')[0].slice(1), [600, 0, 2000]);
  assert.equal(second.of('texSubImage2D').length, 0, 'nothing staged, nothing uploaded');
  assert.equal(run([pool]).draws, 0, 'no time and no record: no draw');
  assert.equal(ctx.of('createFramebuffer').length, 3, 'two targets and the staging, made once');
  run([]);
  assert.equal(ctx.of('deleteFramebuffer').length, 3, 'a pool the world let go of frees them');
});

test('WebGL2 without a 32-bit float colour target refuses the pools by name, half floats too', () => {
  const { run } = webgl(['EXT_color_buffer_half_float']);
  const pool = new ParticlePool({ capacity: 8 });
  pool.emit(0, 0, 0, 0, 1, 0, 2);
  assert.throws(() => run([pool]), /^Error: PARTICLES_UNSUPPORTED/);
  assert.deepEqual([pool.moving, pool.emit(0, 0, 0, 0, 1, 0, 2)], [false, false], 'refused');
});

test('WebGL2: a context restored without 32-bit float targets refuses the pools by name', () => {
  const granted = ['EXT_color_buffer_float'],
    { run } = webgl(granted);
  const pool = new ParticlePool({ capacity: 8 });
  pool.emit(0, 0, 0, 0, 1, 0, 2);
  assert.equal(run([pool]).draws, 1);
  granted.length = 0;
  pool.emit(0, 0, 0, 0, 1, 0, 2);
  assert.throws(() => run([pool]), /^Error: PARTICLES_UNSUPPORTED/, 'never an incomplete target');
});

test('WebGL2: a 1 mm step holds ten kilometres from the world origin', () => {
  const { run } = webgl(),
    model = webglModel(8);
  const pool = new ParticlePool({ capacity: 8, acceleration: [0, 0, 0], origin: [1e4, 0, 1e4] });
  pool.emit(1e4 + 0.25, 2, 1e4, 0.064, 0, 0, 4); // 1 mm each 1/64 s
  let x = 0.25;
  for (let frame = 0; frame < 10; frame++) {
    pool.advance(DT);
    model.step(run([pool]).of);
    const moved = model.particle(0)[0] - x;
    assert.ok(Math.abs(moved - 0.001) <= 2 ** -20, `step ${frame}: ${moved * 1000} mm`);
    x += moved;
  }
});

test('WebGL2: a particle of a 60 s lifetime dies after 60 s of 144 Hz steps, and stays put', () => {
  const { run } = webgl(),
    model = webglModel(8),
    hz = 144;
  const pool = new ParticlePool({ capacity: 8, acceleration: [0, 0, 0] });
  pool.emit(0, 0, 0, 0, 1, 0, 60);
  let died = 0,
    steps = 0,
    atDeath: number[] = [];
  for (; pool.moving && steps < 62 * hz; steps++) {
    pool.advance(1 / hz);
    model.step(run([pool]).of);
    const particle = model.particle(0);
    if (!died && particle[3] >= particle[7]) [died, atDeath] = [steps + 1, particle];
  }
  assert.ok(Math.abs(died - 60 * hz) <= 3, `died at step ${died} of ${60 * hz}`);
  assert.ok(steps > died, 'stepped on past its death');
  assert.deepEqual(model.particle(0), atDeath, 'dead: neither aged nor moved');
  assert.ok(Math.abs(atDeath[1] - 60) < 0.02, `rose 60 m: ${atDeath[1]}`);
});
