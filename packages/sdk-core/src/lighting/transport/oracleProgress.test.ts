import test from 'node:test';
import assert from 'node:assert/strict';
import type { TransportProgress } from './contracts.ts';
import { solveTransportOracle } from './oracle.ts';
import { ones, system } from './oracle.fixture.ts';

test('the oracle reports progress from zero to its total, now and then inside a long channel', () => {
  for (const size of [1, 2, 32, 40]) {
    const events: TransportProgress[] = [];
    solveTransportOracle(system(Array(size * size).fill(0.5 / size), ones(size), ones(size)), {
      onProgress: (event) => events.push(event),
    });
    assert.ok(
      events.every(
        (event) => event.stage === 'oracle' && event.total === size * 3 && event.eventVersion === 1,
      ),
    );
    const done = events.map((event) => event.completed);
    assert.deepEqual([done[0], done.at(-1)], [0, size * 3]);
    assert.ok(
      done.every((value, i) => i === 0 || value > done[i - 1]),
      `${done}`,
    );
    for (let channel = 0; channel < 3; channel++)
      assert.ok(done.includes(channel * size), `${size} ${done}`);
    if (size > 2) {
      assert.ok(
        done.some((value) => value > 0 && value < size),
        `${done}`,
      );
      // Progress is a summary: far fewer events than pivots.
      assert.ok(events.length < size, `${events.length}`);
    }
  }
});

test('a cancellation stops the oracle before it publishes any further progress', () => {
  assert.throws(
    () => solveTransportOracle(system([0.5], ones(1), ones(1)), { cancelled: () => true }),
    (error: any) => error.code === 'CANCELLED',
  );
  let requested = false;
  const events: unknown[] = [];
  assert.throws(
    () =>
      solveTransportOracle(system(Array(1600).fill(0.01), ones(40), ones(40)), {
        cancelled: () => requested,
        onProgress: (event) => {
          events.push(event);
          requested = true;
        },
      }),
    (error: any) => error.code === 'CANCELLED',
  );
  assert.equal(events.length, 1);
});
