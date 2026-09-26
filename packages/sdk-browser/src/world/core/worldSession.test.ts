import test from 'node:test';
import assert from 'node:assert/strict';
import { attachParticles, awaitViewPages, registerWorld } from './worldSession.ts';
import type { MeasuredWorld } from '../session/explorer.ts';
import type { BeforeFrameInfo, World } from './world.ts';
import { ParticlePool } from '../../../../sdk-core/src/fluids/particles.ts';

test('world.awaitPages waits for the scene, then for pages alone, never an image, heard (#408)', async () => {
  const steps: unknown[] = [];
  const session = {
    awaitPages: async (options?: { image?: boolean }) => void steps.push(options),
  } as unknown as MeasuredWorld;
  const runtime = { settled: async () => void steps.push('settled') };
  const onProgress = () => {};
  await awaitViewPages(runtime, () => session, onProgress);
  assert.deepEqual(steps, ['settled', { image: false, onProgress }]);
});

test('attachParticles gives the pool to every session and the frames the world draws (#420)', () => {
  type Hook = (frame: BeforeFrameInfo) => void;
  const hooks = new Set<Hook>();
  let asked = 0;
  const world = {
    beforeFrame: (hook: Hook) => (hooks.add(hook), () => hooks.delete(hook)),
    invalidate: () => void asked++,
  } as unknown as World;
  const held = { particles: [] as ParticlePool[] };
  registerWorld(world, { session: () => null, last: () => null }, held);
  const pool = new ParticlePool({ capacity: 8 });
  const remove = attachParticles(world, pool);
  assert.deepEqual([held.particles, asked], [[pool], 1], 'held, and a frame asked');
  for (const again of [world, {} as World])
    assert.throws(() => attachParticles(again, pool), /^Error: PARTICLES_ATTACH/);
  const frame = () => hooks.forEach((hook) => hook({ delta: 0.02, time: 0.02 }));
  frame();
  assert.equal(asked, 1, 'an idle pool asks for no frame');
  pool.emit(0, 0, 0, 0, 1, 0, 2);
  frame();
  assert.equal(asked, 2, 'a moving one asks for the next');
  assert.equal(pool.flush().dt, 0.02, "the world's frame time is the step's, the idle one not");
  remove();
  assert.deepEqual([held.particles, hooks.size], [[], 0]);
});
