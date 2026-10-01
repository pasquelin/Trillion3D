// #1232: a world of thousands of placements of a few props opens and draws its first image on
// WebGPU under a renderer's memory cap that the per-placement rows ran out of. #410's aerial scene
// (`bench/runner/scenes/aerial.ts`: 3 664 nodes, 38.6 M instanced triangles on a few hundred
// thousand) is cooked by this checkout's native compiler and opened in a child process at the
// boss's case (`view-rows-load.fixture.ts`). On develop with #1235 merged (47884ceca), the rows sized
// by residency × placements, the child's renderer peaked at 598 MB before its first image; here,
// the rows sized by what the view's cut selects, at 325 MB. The cap sits between.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aerialScene } from '../../bench/runner/scenes/aerial.ts';
import { compiler } from './world-partition.fixture.ts';
import { OUT_OF_MEMORY } from './view-rows-load.fixture.ts';

/** The renderer's memory cap, in MB: under develop's peak, over this branch's. */
const CAP_MB = 450;
const child = fileURLToPath(new URL('./view-rows-load.fixture.ts', import.meta.url));

/** Cooks #410's aerial scene under `root`; returns its manifest. */
async function cookedAerial(root: string) {
  const { gltf, binary } = aerialScene(410, 3600, 600);
  const source = join(root, 'source');
  await mkdir(source, { recursive: true });
  await writeFile(join(source, 'aerial.gltf'), JSON.stringify(gltf));
  await writeFile(join(source, 'aerial.bin'), binary);
  const args = [
    'source',
    'cache',
    'full',
    '150000',
    '2',
    '4096',
    '../../../../source/',
    'qem-endpoints',
  ];
  execFileSync(compiler, args, { cwd: root, stdio: 'ignore' });
  return join(root, 'cache/native/full/manifest.json');
}

test(
  'a world of thousands of placements opens and draws under a cap the per-placement rows passed',
  { skip: !existsSync(compiler), timeout: 300_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'view-rows-load-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const manifest = await cookedAerial(root);
    const run = spawnSync(
      process.execPath,
      [
        `--max-old-space-size=${CAP_MB}`,
        '--experimental-strip-types',
        child,
        manifest,
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
    assert.equal(
      opened.cut,
      'view rows',
      'cut on the CPU, which claims a row per cluster it selects',
    );
    assert.ok(opened.peakMb <= CAP_MB);
  },
);
