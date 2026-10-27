// The hair strands' GPU work against the same values in doubles: the tangents written once at load
// (a point's direction through its neighbours on the strand and the second axis of its basis, two
// signed bytes' steps at most apart) and the macro groups' bounds and voxel sizes (the instances'
// boxes as whole numbers of a ten-micrometre step, reduced to one box a macro group, within a step).
// Run on the example scene (`pnpm fixtures:hair-strands` compiles it) and on a groom of two groups.
//
//   node bench/dawn/proofs.ts tests/gpu/hair/strands-bounds.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runOnDawn } from '../../kit/device/onDawn.ts'
import { sceneCacheFiles } from '../../kit/scenes/caches.ts'
import { REPOSITORY_ROOT } from '../../../scripts/git/repository-files.ts'
import { parseHairStrands } from '../../../packages/sdk-core/src/hair/hairStrandsFile.ts'
import { hairStrandsFixture } from '../../../packages/sdk-core/src/hair/hairStrandsFile.fixture.ts'
import { runHairStrands } from './strandsRun.ts'

/** What a run must hold: no GPU error, something compared, every gap within its step. */
function assertMatches(result: Awaited<ReturnType<typeof runHairStrands>>) {
  assert.ok(!('unavailable' in result), 'WebGPU must be available')
  assert.deepEqual(result.errors, [], 'no GPU error')
  assert.ok(result.tangentsCompared > 0, 'tangents were compared')
  assert.ok(result.tangentGap <= 1.01, `a tangent is ${result.tangentGap} steps off`)
  assert.equal(result.macroGroups, 1, 'the groups of one groom share their bounds: one macro group')
  assert.equal(result.entryCount, 1)
  assert.ok(result.compared > 0)
  // The bounds are exact to the step: the box floats times the scale, cut toward zero, twice.
  assert.ok(result.boundGap <= 2, `a bound is ${result.boundGap} steps off`)
  assert.ok(result.sizeGap < 1e-4, `a voxel size is ${result.sizeGap} off, relatively`)
}

test(
  'the example groom: the tangents and the macro group bounds are the doubles’',
  { timeout: 120_000 },
  async () => {
    const [file] = (await sceneCacheFiles('hairStrands.bin')).filter((path) =>
      path.includes('/hair-strands/'),
    )
    assert.ok(file, 'the example is compiled: pnpm fixtures:hair-strands')
    const strands = parseHairStrands(new Uint8Array(await readFile(resolve(REPOSITORY_ROOT, file))))
    assert.ok(strands.groups.length >= 1)
    assertMatches(await runOnDawn(runHairStrands, strands))
  },
)

test(
  'a groom of two groups: both are reduced into the one macro group',
  { timeout: 120_000 },
  async () => {
    const strands = parseHairStrands(
      hairStrandsFixture([
        {
          id: 0,
          curves: [
            [0, 0, 0, 0.1, 0.3, 0, 0.3, 0.6, 0.1],
            [0.2, 0, 0.1, 0.2, 0.2, 0.2],
          ],
        },
        { id: 1, curves: [[-0.4, 0.2, 0, -0.4, 0.5, 0.1, -0.2, 0.8, 0.2, 0, 1, 0.2]] },
      ]),
    )
    assertMatches(await runOnDawn(runHairStrands, strands))
  },
)
