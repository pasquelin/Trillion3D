// The compute-path governor (`governor.ts`), with an injected deterministic clock:
// each test builds its own governor, never reading a real thread clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PATH_EXPLORE_EVERY,
  PATH_MIN_SAMPLES,
  PATH_SWITCH_RUNS,
  createPathGovernor,
} from './governor.ts';

/** Fine clock (1 µs step): its resolution falls under the arbitration threshold. */
function horlogeFine() {
  let t = 0;
  return () => (t += 0.001);
}

/** Coarse clock (1 ms step): its resolution stays above the arbitration threshold. */
function horlogeGrossiere() {
  let t = 0;
  return () => (t += 1);
}

/** N identical observations of the same path, to establish or feed its median. */
function observeN(
  gouverneur: ReturnType<typeof createPathGovernor>,
  path: 'js' | 'wasm',
  ms: number,
  fois: number,
) {
  for (let i = 0; i < fois; i++) gouverneur.observe('op', path, ms, 10);
}

test('under PATH_MIN_SAMPLES samples on the other path, no switch', () => {
  const g = createPathGovernor(horlogeFine(), 'auto');
  g.setWasm(true, true, null);
  observeN(g, 'js', 10, 1); // establishes the current path
  observeN(g, 'wasm', 5, PATH_MIN_SAMPLES - 1); // wasm clearly faster, but still too few samples
  assert.equal(g.metrics().operations.op.path, 'js');
  assert.equal(g.metrics().operations.op.switches, 0);
});

test('switches after five consecutive runs at least 20% ahead', () => {
  const g = createPathGovernor(horlogeFine(), 'auto');
  g.setWasm(true, true, null);
  observeN(g, 'js', 10, PATH_MIN_SAMPLES); // JS median = 10 ns/element
  // Four observations bring wasm to PATH_MIN_SAMPLES samples; the next five are the
  // consecutive runs 21% ahead (7.9 < 10 · (1 - 0.2) = 8).
  observeN(g, 'wasm', 7.9, PATH_MIN_SAMPLES - 1 + PATH_SWITCH_RUNS);
  const op = g.metrics().operations.op;
  assert.equal(op.path, 'wasm');
  assert.equal(op.switches, 1);
});

test('does not switch at 19% ahead, even after many runs', () => {
  const g = createPathGovernor(horlogeFine(), 'auto');
  g.setWasm(true, true, null);
  observeN(g, 'js', 10, PATH_MIN_SAMPLES);
  // 8.1 = 10 · (1 - 0.19): under the 20% threshold, no run qualifies.
  observeN(g, 'wasm', 8.1, PATH_MIN_SAMPLES - 1 + PATH_SWITCH_RUNS * 2);
  const op = g.metrics().operations.op;
  assert.equal(op.path, 'js');
  assert.equal(op.switches, 0);
});

test('does not switch after only four qualifying runs', () => {
  const g = createPathGovernor(horlogeFine(), 'auto');
  g.setWasm(true, true, null);
  observeN(g, 'js', 10, PATH_MIN_SAMPLES);
  observeN(g, 'wasm', 7.9, PATH_MIN_SAMPLES - 1 + (PATH_SWITCH_RUNS - 1));
  const op = g.metrics().operations.op;
  assert.equal(op.path, 'js');
  assert.equal(op.switches, 0);
});

test('passive exploration once every PATH_EXPLORE_EVERY, without changing the current path', () => {
  const g = createPathGovernor(horlogeFine(), 'auto');
  g.setWasm(true, true, null);
  observeN(g, 'js', 10, PATH_EXPLORE_EVERY - 1); // equalises runs to PATH_EXPLORE_EVERY - 1
  assert.equal(g.metrics().operations.op.path, 'js');
  assert.equal(g.choose('op'), 'wasm', 'the exploration run plays the other path');
  assert.equal(g.metrics().operations.op.path, 'js', 'choose() never changes the current path');
});

test('JS fallback when the WebAssembly module is absent', () => {
  const g = createPathGovernor(horlogeFine(), 'auto');
  g.setWasm(false, null, 'WebAssembly module unavailable');
  assert.equal(g.choose('op'), 'js');
});

test('JS fallback when the clock is too coarse to arbitrate', () => {
  const g = createPathGovernor(horlogeGrossiere(), 'auto');
  g.setWasm(true, true, null);
  assert.equal(g.metrics().clockCoarse, true);
  assert.equal(g.choose('op'), 'js');
});

test('a missing timer (ms null) drops the operation back to JS', () => {
  const g = createPathGovernor(horlogeFine(), 'auto');
  g.setWasm(true, true, null);
  g.observe('op', 'wasm', null, 10);
  assert.equal(g.metrics().operations.op.path, 'js');
  assert.equal(g.choose('op'), 'js');
});

test("mathPath: 'js' forces the JavaScript path even if Wasm is available", () => {
  const g = createPathGovernor(horlogeFine(), 'js');
  g.setWasm(true, true, null);
  assert.equal(g.choose('op'), 'js');
});

test("mathPath: 'wasm' forces the Wasm path when available, otherwise falls back to JS", () => {
  const disponible = createPathGovernor(horlogeFine(), 'wasm');
  disponible.setWasm(true, true, null);
  assert.equal(disponible.choose('op'), 'wasm');

  const absent = createPathGovernor(horlogeFine(), 'wasm');
  absent.setWasm(false, null, 'WebAssembly module unavailable');
  assert.equal(absent.choose('op'), 'js');
});

test('metrics are null for what has never been measured, and an unknown operation does not exist', () => {
  const g = createPathGovernor(horlogeFine(), 'auto');
  g.setWasm(true, true, null);
  g.observe('op', 'js', 10, 10);
  const op = g.metrics().operations.op;
  assert.equal(op.jsNsPerElement, 1e6); // 10 ms on 10 elements: (10 · 1e6 ns) / 10 = 1e6 ns/element
  assert.equal(op.wasmNsPerElement, null);
  assert.equal(op.wasmSamples, 0);
  assert.equal(g.metrics().operations['jamaisAppelee'], undefined);
});
