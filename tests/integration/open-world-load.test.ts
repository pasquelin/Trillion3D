// #1232: the open world (pasquelin/Trillion3D-openworld: 118 436 nodes, 17.5 M instances, 1 326
// primitives) opens and draws its first image on WebGPU at the boss's case (1728×1117 CSS pixels,
// DPR 2), on the mock device with an Apple M2's limits, under a stated memory cap
// (`view-rows-load.fixture.ts`). Its world roots weighed 866 MiB as one JSON string, past the
// 512 MiB V8 holds, so develop could not open it in Node or in Chrome; cooked as records
// (`world-roots.table`, 96 MiB, and `world-roots.dag`, 203 MiB, read on the stream's first use) it
// opens. The group closure holds a primitive's groups once, not once per placement selected: on
// the same cook the child's peak renderer memory falls from 6.0 GB, the closure keyed per instance,
// to 4.6 GB (JS heap 1.5 GB), the cap between.
//
// The open world cooks in about ten minutes, far past a test's: this one opens a cook of it by
// this checkout's native compiler, named by `T3D_OPEN_WORLD` (its `manifest.json`), and skips when
// there is none, or when the cook predates the records.
//
//   T3D_OPEN_WORLD=<cache>/native/full/manifest.json node --test tests/integration/open-world-load.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compiler } from './world-partition.fixture.ts';
import { OUT_OF_MEMORY } from './view-rows-load.fixture.ts';

/** The renderer's memory cap, in MB: the JS heap and its array buffers, the mock device's own
 *  buffers out. */
const CAP_MB = 5120;
/** The JS heap's own, in MB: half of the 4 GiB a Chrome renderer's V8 heap holds. */
const HEAP_MB = 2048;
const child = fileURLToPath(new URL('./view-rows-load.fixture.ts', import.meta.url));

/** The open world's cook `T3D_OPEN_WORLD` names, when it holds the world roots as records. */
function openWorld() {
  const manifest = process.env.T3D_OPEN_WORLD;
  if (!manifest || !existsSync(manifest)) return undefined;
  const { url } = JSON.parse(readFileSync(manifest, 'utf8')) as { url: string };
  return existsSync(join(dirname(manifest), dirname(url), 'world-roots.table'))
    ? manifest
    : undefined;
}

const manifest = openWorld();

test(
  'the open world opens and draws its first image at the boss’s case under its memory cap',
  { skip: !existsSync(compiler) || !manifest, timeout: 300_000 },
  (t) => {
    const run = spawnSync(
      process.execPath,
      [
        `--max-old-space-size=${HEAP_MB}`,
        '--experimental-strip-types',
        child,
        manifest!,
        `${CAP_MB}`,
      ],
      { encoding: 'utf8', maxBuffer: 1 << 26 },
    );
    const last = run.stdout.trim().split('\n').at(-1) ?? '';
    t.diagnostic(last);
    assert.notEqual(run.status, OUT_OF_MEMORY, `ran out of memory: ${last}`);
    assert.equal(run.status, 0, run.stderr.slice(-2000));
    const opened = JSON.parse(last) as { drawn: boolean; cut: string; peakMb: number };
    assert.ok(opened.drawn, 'its first image is drawn');
    assert.equal(opened.cut, 'view rows', 'cut on the CPU, a row per cluster it selects');
    assert.ok(opened.peakMb <= CAP_MB);
  },
);
