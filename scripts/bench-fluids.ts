#!/usr/bin/env node
// The fluids spike bench (#419), in Node and natively, no browser: (1) the height gap between the
// CPU wave model and its generated shader code run in 32 bits; (2) the physics thread's buoyancy
// for the floating scene (100 bodies: cubes, sliced planks, compound rafts, balls) in the
// committed web modules, split into its TypeScript share (the module's pieces query and the
// planes from the waves) and its C++ share (the BUOYANCY command); (3) the C++ share natively.
// The C++ share in the module is the step with the command run twice, the second copy at density
// 0 (every volume computed, no impulse), less the step with it once, on alternate steps.
//   node scripts/bench-fluids.ts [--threads 1,8] [--steps 600] [--native <joltWaterBench>]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Worker, isMainThread, workerData } from 'node:worker_threads';
import {
  StepWords,
  createWater,
  sliceLength,
  type WaterSpec,
} from '../packages/sdk-core/src/fluids/index.ts';
import { OCEAN, heightGap } from '../packages/sdk-core/src/fluids/waveCode.fixture.ts';
import {
  DEFAULT_PHYSICS_BUDGET,
  WATER_PIECE_WORDS,
} from '../packages/sdk-core/src/physics/index.ts';
import { openJolt, startJolt } from '../packages/sdk-browser/src/physics/joltModule.ts';
import {
  runJoltThread,
  type JoltThreadStart,
} from '../packages/sdk-browser/src/physics/joltThreads.ts';
import { floatingScene } from '../packages/sdk-browser/src/physics/water.fixture.ts';

const PHYSICS = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'packages',
  'sdk-browser',
  'src',
  'physics',
);
const BODIES = 100;
const TIERS: [string, WaterSpec][] = [
  ['4 waves (performance)', { waves: OCEAN.slice(0, 4), level: 0 }],
  ['8 waves (high)', { waves: OCEAN, level: 0 }],
];

const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  return {
    median: at(0.5),
    p95: at(0.95),
    mean: values.reduce((a, b) => a + b, 0) / values.length,
  };
};
const ms = (value: number) => `${value.toFixed(3)} ms`;

async function web(spec: WaterSpec, threads: number, steps: number) {
  const spawn = (start: JoltThreadStart) =>
    new Worker(fileURLToPath(import.meta.url), { workerData: start }).unref();
  const file = threads > 1 ? 'joltPhysicsThreads.wasm' : 'joltPhysics.wasm';
  const opened = await openJolt(
    readFileSync(join(PHYSICS, file)),
    1 << 30,
    threads > 1 ? { count: threads, spawn } : null,
  );
  const jolt = startJolt(
    opened,
    { ...DEFAULT_PHYSICS_BUDGET, bodies: 128, memoryBytes: 1 << 30 },
    threads,
  );
  jolt.step(floatingScene(BODIES), 0);
  const water = createWater(spec),
    words = new StepWords(),
    cut = sliceLength(water);
  const planes: number[] = [],
    once: number[] = [],
    twice: number[] = [];
  let pieces = 0;
  for (let s = 0; s < steps; s++) {
    const t0 = performance.now();
    water.waves.setTime(s / 60);
    const read = jolt.water(water.level + water.waves.crest, cut);
    pieces = read.length / WATER_PIECE_WORDS;
    let count = words.write(water, read, pieces, null);
    const t1 = performance.now();
    if (s % 2) {
      // The same command again, at density 0: all its work, none of its effect.
      words.words.copyWithin(count, 0, count);
      new Float32Array(words.words.buffer)[count + 2] = 0;
      count *= 2;
    }
    jolt.step(words.words, 1 / 60, count);
    (s % 2 ? twice : once).push(performance.now() - t1);
    planes.push(t1 - t0);
  }
  const apply = stats(twice).median - stats(once).median;
  const ts = stats(planes);
  console.log(
    `  wasm ${threads} thread(s), ${pieces} pieces: TS query + planes median ${ms(ts.median)} p95 ${ms(ts.p95)}; ` +
      `C++ BUOYANCY ${ms(apply)}; total ${ms(ts.median + apply)}`,
  );
}

function native(tool: string, spec: WaterSpec, threads: number, steps: number) {
  const file = join(dirname(tool), 'water-scene.bin');
  writeFileSync(file, floatingScene(BODIES));
  const cut = sliceLength(createWater(spec));
  const out = execFileSync(tool, [file, '128', String(threads), String(steps), String(cut)], {
    encoding: 'utf8',
  });
  const lines = out
    .trim()
    .split('\n')
    .map((line) => line.split(' ').map(Number));
  const s = stats(lines.map(([t]) => t));
  console.log(
    `  native ${threads} thread(s), ${lines[0][1]} pieces: C++ query + BUOYANCY median ${ms(s.median)} p95 ${ms(s.p95)}`,
  );
}

if (!isMainThread) await runJoltThread(workerData as JoltThreadStart);
else {
  const { values } = parseArgs({
    options: {
      threads: { type: 'string', default: '1,8' },
      steps: { type: 'string', default: '600' },
      native: { type: 'string' },
    },
  });
  const steps = Number(values.steps);
  console.log('Height gap, CPU vs generated code in 32 bits, 400² points over ±4 km, 8 waves:');
  for (const t of [0, 3600.5, 86400.25])
    console.log(`  t = ${t} s: ${(heightGap(OCEAN, t, 4000, 400) * 1000).toFixed(3)} mm`);
  for (const [name, spec] of TIERS) {
    console.log(`Buoyancy, ${BODIES} bodies, ${name}:`);
    for (const threads of values.threads.split(',').map(Number)) {
      await web(spec, threads, steps);
      if (values.native) native(values.native, spec, threads, steps);
    }
  }
  process.exit(0);
}
