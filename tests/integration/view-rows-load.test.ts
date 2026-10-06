// A world of thousands of placements of a few props opens and draws its first image on
// WebGPU under a renderer's memory cap that per-placement rows run out of. The aerial scene
// (`bench/runner/scenes/aerial.ts`: 3 664 nodes, 38.6 M instanced triangles on a few hundred
// thousand) is cooked by this checkout's native compiler and opened in a child process at the
// one case (`view-rows-load.fixture.ts`, one byte range served alone). Rows sized by residency ×
// placements take the child's renderer to 579 MB before its first image; rows sized by what the
// view's cut selects take it to 258 MB. The cap sits between.
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { aerialScene } from '../../bench/runner/scenes/aerial.ts'
import { compiler } from './world-partition.fixture.ts'
import { assertOpensUnderCap } from './view-rows-load.fixture.ts'

/** The renderer's memory cap, in MB: under develop's peak, over this branch's. */
const CAP_MB = 450

/** Cooks the aerial scene under `root`; returns its manifest. */
async function cookedAerial(root: string) {
  const { gltf, binary } = aerialScene(410, 3600, 600)
  const source = join(root, 'source')
  await mkdir(source, { recursive: true })
  await writeFile(join(source, 'aerial.gltf'), JSON.stringify(gltf))
  await writeFile(join(source, 'aerial.bin'), binary)
  const args = [
    'source',
    'cache',
    'full',
    '150000',
    '2',
    '4096',
    '../../../../source/',
    'qem-endpoints',
  ]
  execFileSync(compiler, args, { cwd: root, stdio: 'ignore' })
  return join(root, 'cache/native/full/manifest.json')
}

test(
  'a world of thousands of placements opens and draws under a cap the per-placement rows passed',
  { skip: !existsSync(compiler), timeout: 300_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'view-rows-load-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const manifest = await cookedAerial(root)
    assertOpensUnderCap(t, manifest, CAP_MB, CAP_MB)
  },
)
