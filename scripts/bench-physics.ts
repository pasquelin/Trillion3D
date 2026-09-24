#!/usr/bin/env node
// The physics step bench: the `ten-thousand-bodies` example's scene (N boxes in ten layers over a
// floor), stepped at 60 Hz until every box sleeps, by the committed web modules in node
// (single-threaded, and threaded on workers) and, when built, by the same C API compiled natively
// (`packages/physics-jolt-wasm/bench/native.cpp`, same Jolt, same command words). Prints, per run,
// the mean and worst step of the fall-and-landing window and the step at which all sleep.
//   node scripts/bench-physics.ts [--bodies 1000,5000,10000] [--threads 1,4] [--native <joltBench>]
//     [--wasm <module>]
// A per-phase profile needs the profiled builds (`-DPROFILE=ON`, `bench/profile.cpp`): the native
// tool from `cmake -S packages/physics-jolt-wasm -B <dir> -DCMAKE_BUILD_TYPE=Distribution
// -DPROFILE=ON`, the module from the same with `emcmake` and `-DTHREADS=ON`, given as `--wasm`.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Worker, isMainThread, workerData } from 'node:worker_threads';
import {
  CommandWriter,
  DEFAULT_PHYSICS_BUDGET,
  LAYER,
  MOTION,
  PHYSICS_MATERIALS,
  SHAPE,
} from '../packages/sdk-core/src/physics/index.ts';
import { Quaternion } from '../packages/sdk-core/src/world/math/quaternion.ts';
import { openJolt, startJolt } from '../packages/sdk-browser/src/physics/joltModule.ts';
import { seeded } from '../site/examples/kit/random.ts';
import {
  runJoltThread,
  type JoltThreadStart,
} from '../packages/sdk-browser/src/physics/joltThreads.ts';

const PHYSICS = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'packages',
  'sdk-browser',
  'src',
  'physics',
);
/** Steps timed: 10 simulated seconds hold the fall, the landing and the settling. */
const STEPS = 600;
/** The fall-and-landing window whose steps are averaged: the first 3 simulated seconds. */
const WINDOW = 180;

/** The example's scene as command words: a stone floor, then `count` wooden boxes in ten layers,
 *  laid out by the same seeded sequence (`site/examples/ten-thousand-bodies.html`). */
function scene(count: number) {
  const writer = new CommandWriter();
  const body = (id: number, motion: number, position: number[], turn: Quaternion, half: number) => {
    const matter = motion === MOTION.static ? PHYSICS_MATERIALS.stone : PHYSICS_MATERIALS.wood;
    writer.add({
      id,
      motion,
      layer: motion === MOTION.static ? LAYER.static : LAYER.moving,
      shape: SHAPE.box,
      flags: 0,
      position,
      quaternion: turn.elements,
      size: motion === MOTION.static ? [60, 1, 60] : [half, half, half],
      mass: 0,
      gravityScale: 1,
      ...matter,
    });
  };
  body(0, MOTION.static, [0, -1, 0], new Quaternion(), 0);
  const next = seeded(11),
    side = Math.ceil(Math.sqrt(count / 10)),
    turn = new Quaternion();
  for (let i = 0; i < count; i++) {
    const layer = Math.floor(i / (side * side)),
      cell = i % (side * side);
    const x = ((cell % side) - side / 2) * 1.6 + next() * 0.4;
    const z = (Math.floor(cell / side) - side / 2) * 1.6 + next() * 0.4;
    turn.setFromEuler({ x: next(), y: next(), z: next(), order: 'XYZ' });
    body(i + 1, MOTION.dynamic, [x, 4 + layer * 1.6, z], turn, 0.4);
  }
  return writer.take();
}

/** The landing window a profiled build's per-phase totals cover (`bench/native.cpp`). */
const PROFILE_FROM = 50,
  PROFILE_TO = 180;
/** The engine's default budget, its bodies the scene's (the floor included) and memory unbounded. */
const budgetFor = (bodies: number) => ({
  ...DEFAULT_PHYSICS_BUDGET,
  bodies: bodies + 1,
  memoryBytes: 1 << 30,
});
type Run = { steps: { ms: number; active: number; full?: number }[]; phases: Map<string, number> };

/**
 * The first step apart (it builds every contact cache), the mean, p95 and worst of the rest of
 * the window, the first step after which nothing is awake, and the per-phase profile if any.
 */
function summary(label: string, { steps, phases }: Run) {
  const window = steps.slice(1, WINDOW).map((r) => r.ms);
  const sorted = [...window].sort((a, b) => a - b);
  const mean = window.reduce((a, b) => a + b, 0) / window.length;
  const asleep = steps.findIndex((r) => r.active === 0);
  const [p95, worst] = [sorted[Math.floor(sorted.length * 0.95)], sorted[sorted.length - 1]];
  const text = `${label}: first ${steps[0].ms.toFixed(1)} ms, mean ${mean.toFixed(2)}, p95 ${p95.toFixed(2)}, worst ${worst.toFixed(2)} ms`;
  const full = steps.filter((r) => r.full).length;
  const note = full ? `, contact budgets exceeded in ${full} steps` : '';
  console.log(`${text}, all asleep at step ${asleep < 0 ? `> ${STEPS}` : asleep + 1}${note}`);
  const top = [...phases].sort((a, b) => b[1] - a[1]).slice(0, 14);
  for (const [name, ms] of top)
    console.log(`    ${name.padEnd(40)} ${ms.toFixed(3)} thread-ms/step`);
}

type Profiled = {
  jolt_profile_name(i: number): number;
  jolt_profile_ms(i: number): number;
  jolt_profile_reset(): void;
};

async function web(words: Uint32Array, bodies: number, threads: number, file: string | undefined) {
  const name = threads > 1 ? 'joltPhysicsThreads.wasm' : 'joltPhysics.wasm';
  const spawn = (start: JoltThreadStart) =>
    new Worker(fileURLToPath(import.meta.url), { workerData: start }).unref();
  const pool = threads > 1 || file ? { count: threads, spawn } : null;
  const opened = await openJolt(readFileSync(file ?? join(PHYSICS, name)), 1 << 30, pool);
  const jolt = startJolt(opened, budgetFor(bodies), threads);
  const profile =
    'jolt_profile_name' in opened.exports ? (opened.exports as unknown as Profiled) : null;
  const phases = new Map<string, number>();
  jolt.step(words, 0);
  const steps = [];
  for (let s = 0; s < STEPS; s++) {
    if (profile && s === PROFILE_FROM) profile.jolt_profile_reset();
    if (profile && s === PROFILE_TO)
      for (let i = 0; i < 256; i++) {
        const at = profile.jolt_profile_name(i);
        if (!at) continue;
        const bytes = new Uint8Array(opened.memory.buffer, at, 128);
        const text = new TextDecoder().decode(bytes.slice(0, bytes.indexOf(0)));
        phases.set(text, profile.jolt_profile_ms(i) / (PROFILE_TO - PROFILE_FROM));
      }
    const t = performance.now();
    jolt.step(null, 1 / 60);
    steps.push({ ms: performance.now() - t, active: jolt.active(), full: jolt.overflow().length });
  }
  return { steps, phases };
}

function native(tool: string, words: Uint32Array, bodies: number, threads: number): Run {
  const file = join(dirname(tool), 'commands.bin');
  writeFileSync(file, words);
  const budget = budgetFor(bodies);
  const sizes = [budget.bodies, budget.bodyPairs, budget.contactConstraints, threads, STEPS];
  const out = execFileSync(tool, [file, ...sizes.map(String)], { encoding: 'utf8' });
  const phases = new Map<string, number>();
  const steps = [];
  for (const line of out.trim().split('\n')) {
    const parts = line.startsWith('#') ? line.split('\t') : line.split(' ');
    if (parts[0] === '#') phases.set(parts[1], Number(parts[2]));
    else steps.push({ ms: Number(parts[0]), active: Number(parts[1]) });
  }
  return { steps, phases };
}

if (!isMainThread) await runJoltThread(workerData as JoltThreadStart);
else {
  const { values } = parseArgs({
    options: {
      bodies: { type: 'string', default: '1000,5000,10000' },
      threads: { type: 'string', default: '1,4' },
      native: { type: 'string' },
      wasm: { type: 'string' },
    },
  });
  for (const bodies of values.bodies.split(',').map(Number)) {
    const words = scene(bodies);
    for (const threads of values.threads.split(',').map(Number)) {
      summary(`${bodies} wasm ${threads} threads`, await web(words, bodies, threads, values.wasm));
      if (values.native)
        summary(
          `${bodies} native ${threads} threads`,
          native(values.native, words, bodies, threads),
        );
    }
  }
  process.exit(0);
}
