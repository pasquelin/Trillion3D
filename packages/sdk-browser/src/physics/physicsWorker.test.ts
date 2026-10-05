import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandWriter, POSE_WORDS } from '../../../sdk-core/src/physics/index.ts';
import { body } from './records.fixture.ts';
import { startedWorker } from './worker.fixture.ts';

test('a tick of several steps reports its slowest step as stepMaxMs, not their mean', async () => {
  // The worker's clock: each read returns `now`, then moves it on by the next scripted amount.
  let now = 0;
  const advances: number[] = [];
  const clock = () => {
    const read = now;
    now += advances.shift() ?? 0;
    return read;
  };
  const { sent, receive } = await startedWorker(clock);
  // A command wakes the world; the frame owes three steps, each reading the clock twice: steps of
  // 2, 9 and 4 ms. No other read counts a step.
  receive({ type: 'commands', words: new Uint32Array(0) });
  advances.push(2, 0, 9, 0, 4, 0);
  receive({ type: 'advance', to: 3, steps: 3 });
  const results = sent.filter((m) => m.type === 'results');
  assert.equal(results.length, 1);
  const [tick] = results;
  assert.equal(tick.steps, 3);
  assert.equal(tick.step, 3, 'the simulation stands at the page step it was asked');
  assert.equal(tick.stepMs, 15, 'the steps summed');
  assert.equal(tick.stepMaxMs, 9, 'the slowest step, not the mean (5) nor 0');
});

test('a world at rest takes no step, and says so once to a page that woke it', async () => {
  const { sent, receive } = await startedWorker(() => 0);
  const posted = () => sent.filter((m) => m.type === 'results' || m.type === 'rest');
  // The page's first commands: one step runs them, and leaves nothing awake.
  receive({ type: 'commands', words: new Uint32Array(0) });
  receive({ type: 'advance', to: 1, steps: 1 });
  assert.deepEqual(
    posted().map((m) => m.type === 'results' && [m.steps, m.step, m.resting]),
    [[1, 1, true]],
  );
  const { heard } = posted()[0] as { heard: number };
  // An advance the page sent before it heard: nothing steps, nothing is said.
  receive({ type: 'advance', to: 2, steps: 1 });
  assert.equal(posted().length, 1);
  // Keys that move nothing, then a frame long after: the rest is told once, at the page's step,
  // after one more of the page's waking messages.
  receive({ type: 'input', input: { wishX: 0, wishZ: 0, sprint: false }, jumps: 0 });
  receive({ type: 'advance', to: 90, steps: 2 });
  receive({ type: 'advance', to: 91, steps: 1 });
  assert.deepEqual(posted().slice(1), [{ type: 'rest', step: 90, heard: heard + 1 }]);
});

test('an advance of no step, the clock standing still, runs the commands before it in place', async () => {
  const { sent, receive } = await startedWorker(() => 0);
  const writer = new CommandWriter();
  writer.add(body(1, 2, 5, 0.5));
  receive({ type: 'commands', words: writer.take() });
  const results = () => sent.filter((m) => m.type === 'results');
  assert.equal(results().length, 0, 'commands wait for a step');
  receive({ type: 'advance', to: 0, steps: 0 });
  const [tick] = results();
  assert.deepEqual([tick.steps, tick.poses], [0, 1], 'no step, the body made where it was put');
  const pose = new Float32Array(tick.buffer, 0, POSE_WORDS);
  assert.equal(pose[2], 5);
});
