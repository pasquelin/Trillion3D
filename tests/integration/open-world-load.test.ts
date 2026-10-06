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
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { compiler } from './world-partition.fixture.ts'
import { assertOpensUnderCap } from './view-rows-load.fixture.ts'

/** The renderer's memory cap, in MB: the JS heap and its array buffers, the mock device's own
 *  buffers out. */
const CAP_MB = 5120
/** The JS heap's own, in MB: half of the 4 GiB a Chrome renderer's V8 heap holds. */
const HEAP_MB = 2048

/** The open world's cook `T3D_OPEN_WORLD` names, when it holds the world roots as records. */
function openWorld() {
  const manifest = process.env.T3D_OPEN_WORLD
  if (!manifest || !existsSync(manifest)) return undefined
  const { url } = JSON.parse(readFileSync(manifest, 'utf8')) as { url: string }
  return existsSync(join(dirname(manifest), dirname(url), 'world-roots.table'))
    ? manifest
    : undefined
}

const manifest = openWorld()

test(
  'the open world opens and draws its first image at the boss’s case under its memory cap',
  { skip: !existsSync(compiler) || !manifest, timeout: 300_000 },
  (t) => {
    assertOpensUnderCap(t, manifest!, HEAP_MB, CAP_MB)
  },
)
