// CPU-20, clock part (#919): a clock too coarse to time one execution times pooled batches, and a
// fine clock keeps the governor exactly as it was. The audit's equivalence harness, ported: 10,000
// random observations plus its edge cases (NaN, ±0, ±Inf, empty and maximal batches) against the
// governor as develop wrote it before pooling, restated below as a plain reference.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PATH_EXPLORE_EVERY, PATH_MIN_SAMPLES, createPathGovernor } from './governor.ts';
import type { MathPath, MathPathMode, MathPathOperation } from './contracts.ts';
import { HOSTILE_FLOATS } from '../../../../../tests/kit/assert/hostile.ts';
import { mulberry32 } from '../../../../../site/examples/kit/random.ts';

/** The governor before pooling, on a fine clock: every timed execution is one sample, the median
 *  a typed sort of the last 30 samples, switching after 5 runs at a 20% lead. */
function reference() {
  type Op = MathPathOperation & { samples: Record<MathPath, number[]>; runs: number; lead: number };
  const ops = new Map<string, Op>();
  let mode: MathPathMode = 'auto';
  let available = false;
  const median = (xs: number[]) => {
    if (!xs.length) return null;
    const s = Float64Array.from(xs.slice(-30)).sort();
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const of = (name: string) => {
    const blank = { path: null, switches: 0, elements: 0, runs: 0, lead: 0 };
    if (!ops.has(name)) ops.set(name, { ...blank, samples: { js: [], wasm: [] } } as never);
    return ops.get(name)!;
  };
  return {
    setMode: (next: MathPathMode) => (mode = next),
    setWasm: (loaded: boolean) => (available = loaded),
    choose(name: string): MathPath {
      if (mode !== 'auto') return available || mode === 'js' ? mode : 'js';
      if (!available) return 'js';
      const op = of(name);
      const current = op.path ?? 'wasm';
      const other = current === 'js' ? 'wasm' : 'js';
      return op.runs % PATH_EXPLORE_EVERY === PATH_EXPLORE_EVERY - 1 ? other : current;
    },
    observe(name: string, path: MathPath, ms: number | null, elements: number) {
      const op = of(name);
      op.runs++;
      if (elements <= 0) return;
      op.elements += elements;
      if (ms === null) return void ((op.path = 'js'), (op.lead = 0));
      op.samples[path].push((ms * 1e6) / elements);
      op.path ??= path;
      if (mode !== 'auto' || !available) return;
      const current = op.path;
      const other = current === 'js' ? 'wasm' : 'js';
      const [a, b] = [median(op.samples[current]), median(op.samples[other])];
      const few = Math.min(op.samples.js.length, op.samples.wasm.length) < PATH_MIN_SAMPLES;
      if (few || a === null || b === null) return;
      op.lead = b < a * 0.8 ? op.lead + 1 : 0;
      if (op.lead >= 5) [op.path, op.switches, op.lead] = [other, op.switches + 1, 0];
    },
    reading(name: string): MathPathOperation {
      const { path, switches, elements, samples } = of(name);
      const [jsSamples, wasmSamples] = [samples.js, samples.wasm].map((s) =>
        Math.min(s.length, 30),
      );
      const [jsNsPerElement, wasmNsPerElement] = [median(samples.js), median(samples.wasm)];
      return { path, jsNsPerElement, wasmNsPerElement, jsSamples, wasmSamples, switches, elements };
    },
  };
}

const EDGE_MS = [...HOSTILE_FLOATS, Number.MAX_VALUE, -1, null];
const EDGE_ELEMENTS = [0, -1, 1, Number.MAX_SAFE_INTEGER];

test('on a fine clock, 10,000 random observations and every edge case match the unpooled governor', () => {
  const random = mulberry32(919);
  let t = 0;
  const governor = createPathGovernor(() => (t += 0.001));
  const expected = reference();
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(random() * xs.length)];
  for (let i = 0; i < 10_000; i++) {
    if (random() < 0.01) {
      const mode = pick(['auto', 'auto', 'js', 'wasm'] as const);
      governor.setMode(mode);
      expected.setMode(mode);
    }
    if (random() < 0.01) {
      const loaded = random() < 0.8;
      governor.setWasm(loaded, loaded, loaded ? null : 'absent');
      expected.setWasm(loaded);
    }
    const name = pick(['a', 'b']);
    assert.equal(governor.choose(name), expected.choose(name), `choice ${i}`);
    const path = pick(['js', 'wasm'] as const);
    const ms = random() < 0.1 ? pick(EDGE_MS) : random() * (path === 'js' ? 2 : 1.5);
    const elements = random() < 0.1 ? pick(EDGE_ELEMENTS) : 1 + Math.floor(random() * 1000);
    governor.observe(name, path, ms, elements);
    expected.observe(name, path, ms, elements);
    assert.deepStrictEqual(governor.metrics().operations[name], expected.reading(name), `run ${i}`);
  }
  assert.equal(governor.metrics().clockCoarse, false);
});

/** A 1 ms clock: coarser than an engine batch, its resolution calls for pooled timing (10 ms). */
function coarseGovernor() {
  let t = 0;
  const governor = createPathGovernor(() => (t += 1));
  governor.setWasm(true, true, null);
  return governor;
}

test('a coarse clock pools a path until it spans ten steps, then records one sample', () => {
  const g = coarseGovernor();
  assert.equal(g.metrics().clockCoarse, true);
  g.observe('op', 'js', 4, 10);
  g.observe('op', 'js', 4, 10);
  assert.equal(g.metrics().operations.op.jsSamples, 0, 'eight milliseconds are still pooled');
  g.observe('op', 'js', 4, 10);
  const op = g.metrics().operations.op;
  assert.equal(op.jsSamples, 1);
  assert.equal(op.jsNsPerElement, (12 * 1e6) / 30, 'the pool is timed as one batch');
});

test('a coarse pool: a NaN or an infinity closes it at once, a missing timer drops it', () => {
  const g = coarseGovernor();
  g.observe('op', 'js', 4, 10);
  g.observe('op', 'js', NaN, 10);
  assert.ok(Number.isNaN(g.metrics().operations.op.jsNsPerElement));
  g.observe('op', 'wasm', 4, 10);
  g.observe('op', 'wasm', null, 10);
  g.observe('op', 'wasm', 4, 10);
  assert.equal(g.metrics().operations.op.wasmSamples, 0, 'the timer loss dropped the first four');
  g.observe('op', 'js', -Infinity, 10);
  g.observe('op', 'js', 4, 10);
  assert.equal(
    g.metrics().operations.op.jsSamples,
    2,
    'a -Infinity closes its pool, never poisons it',
  );
});

test('a coarse clock now arbitrates: a path three times faster wins, read through 1 ms steps', () => {
  const g = coarseGovernor();
  const random = mulberry32(20);
  const cost = { js: 0.1, wasm: 0.3 };
  let t = 0;
  for (let i = 0; i < 60_000; i++) {
    const path = g.choose('op');
    const start = Math.floor(t);
    t += cost[path] * (0.75 + random() / 2); // a real batch's duration jitters around its cost
    g.observe('op', path, Math.floor(t) - start, 100);
  }
  const op = g.metrics().operations.op;
  assert.equal(op.path, 'js');
  assert.equal(op.switches, 1);
  assert.ok(Math.abs(op.jsNsPerElement! - 1000) < 150, `js ${op.jsNsPerElement} ns per element`);
  assert.ok(Math.abs(op.wasmNsPerElement! - 3000) < 450, `wasm ${op.wasmNsPerElement} ns`);
});
