import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_PHYSICS_BUDGET, PHYSICS_STEP } from '../../../sdk-core/src/physics/index.ts';
import { PHYSICS_PROTOCOL, resultWords, type FromPhysics, type ToPhysics } from './protocol.ts';

test('a tick of several steps reports its slowest step as stepMaxMs, not their mean', async () => {
  // The worker's clock: each read returns `now`, then moves it on by the next scripted amount.
  let now = 0;
  const advances: number[] = [];
  const clock = () => {
    const read = now;
    now += advances.shift() ?? 0;
    return read;
  };
  Object.defineProperty(performance, 'now', { value: clock, configurable: true });
  const scope = globalThis as unknown as Record<string, unknown>;
  const bytes = await readFile(new URL('./joltPhysics.wasm', import.meta.url));
  scope.fetch = async () => new Response(bytes);
  scope.location = { href: import.meta.url };
  // The worker's ticks run when the test says, never on a timer.
  const ticks: (() => void)[] = [];
  const sent: FromPhysics[] = [];
  let onReady = () => {};
  const ready = new Promise<void>((resolve) => (onReady = resolve));
  scope.postMessage = (message: FromPhysics) => {
    sent.push(message);
    if (message.type === 'ready') {
      scope.setTimeout = (tick: () => void) => ticks.push(tick);
      onReady();
    }
  };
  await import('./physicsWorker.ts');
  const receive = (data: ToPhysics) =>
    (scope.onmessage as (event: { data: ToPhysics }) => void)({ data });
  const budget = { ...DEFAULT_PHYSICS_BUDGET, bodies: 8, memoryBytes: 64 << 20 };
  const buffers = [0, 1].map(() => new ArrayBuffer(resultWords(budget) * 4));
  receive({
    type: 'start',
    protocol: PHYSICS_PROTOCOL,
    wasm: 'joltPhysics.wasm',
    budget,
    threads: 1,
    buffers,
  });
  await ready;
  ticks.shift()!(); // At start, nothing owed yet.
  // A command wakes the world: one step owed; two more steps of time pass before the tick.
  receive({ type: 'commands', words: new Uint32Array(0) });
  now += 2 * PHYSICS_STEP * 1000 + 1;
  // The tick reads the clock once, then twice per step: steps of 2, 9 and 4 ms.
  advances.push(0, 2, 0, 9, 0, 4, 0);
  ticks.shift()!();
  const results = sent.filter((m) => m.type === 'results');
  assert.equal(results.length, 1);
  const [tick] = results;
  assert.equal(tick.steps, 3);
  assert.equal(tick.stepMs, 15, 'the steps summed');
  assert.equal(tick.stepMaxMs, 9, 'the slowest step, not the mean (5) nor 0');
});
