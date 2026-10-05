// The still average's restarts, counters and phases over scripted sequences (a camera move then
// rest, a shadow or a tile landing, a light change, a resize, a scale change, a replay, a hold
// woken): pinned image by image, as the code drew them before its triggers were made one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runOracle } from './restartOracle.fixture.ts';
import { SEQUENCES } from './restartOracle.sequences.fixture.ts';

const golden: Record<string, string[]> = JSON.parse(
  readFileSync(new URL('./restartOracle.golden.json', import.meta.url), 'utf8'),
);

for (const [name, steps] of Object.entries(SEQUENCES))
  test(`the still average of "${name}" restarts, counts and turns as recorded`, () => {
    assert.deepEqual(runOracle(steps), golden[name]);
  });
