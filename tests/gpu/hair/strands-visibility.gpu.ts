// The hair strands' visibility on a real device against ribbons of known coverage: the eight samples a
// pixel holds (which strand, at which depth), the transmittance (saturate(1 - coverage) multiplied
// over the strands, behind the opaque depth), the tiles built from it, the compaction — the pixels'
// descriptors, the coverage texture, the samples placed —, the materials, the depth of the nearest
// strand and the patch of the surfaces. Each scene runs on the device as it is and on one opened
// without the features whose absence takes the polyfills (the 32-bit float blend, the 64-bit atomic
// maximum, subgroups); a strand that crosses the near plane is drawn without a crack.
//
//   node bench/dawn/proofs.ts tests/gpu/hair/strands-visibility.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { FEATURE } from '../../../packages/sdk-browser/src/gpu/core/gpuCaps.ts'
import { runOnDawn } from '../../kit/device/onDawn.ts'
import { runHairVisibility } from './visibilityRun.ts'
import type { SceneName } from './visibilityScenes.ts'

type Run = Awaited<ReturnType<typeof runHairVisibility>>

/** The features whose absence takes each polyfill. */
const POLYFILLS: GPUFeatureName[] = [
  FEATURE.float32Blendable,
  FEATURE.wideAtomics,
  FEATURE.subgroups,
]

/** A run that wrote strands: the device was there, nothing failed, the strands are valid. */
function written(result: Run) {
  assert.ok(!('unavailable' in result), 'WebGPU must be available')
  assert.deepEqual(result.errors, [], 'no GPU error')
  assert.deepEqual(result.failures, [], 'no failure told')
  assert.ok(result.valid, 'the view holds valid strands')
  return result
}

async function assertScene(scene: SceneName, off: GPUFeatureName[]) {
  const run = written(await runOnDawn(runHairVisibility, { scene, off, occluder: false }))
  const { samples, transmittance, tiles, compaction, material, gbuffer } = run
  assert.ok(samples.compared > 0 && samples.covered > 0, 'samples were compared, some covered')
  assert.equal(samples.mismatches, 0, 'every sample is covered where a ribbon covers it')
  assert.equal(samples.ids, 0, 'a covered sample holds its ribbon’s identifier')
  assert.equal(samples.joints, 0, 'the segment joining two strands is not drawn')
  assert.ok(samples.depthGap < 1e-4, `a sample’s depth is ${samples.depthGap} off, relatively`)
  assert.ok(transmittance.compared > 0 && transmittance.touched > 0)
  assert.ok(transmittance.gap < 1e-4, `a transmittance is ${transmittance.gap} off`)
  assert.equal(tiles.mismatches, 0, 'every tile is in the lists its pixels put it in')
  assert.ok(tiles.argsMatch, 'the draw and dispatch arguments follow the counts')
  assert.equal(compaction.nodeMismatches, 0, 'a pixel holds as many strands as its samples do')
  assert.equal(compaction.sampleMismatches, 0, 'a compacted sample has its depth, share and pixel')
  assert.equal(
    compaction.coverageMismatches,
    0,
    'the coverage is the transmittance’s where strands are, else 0',
  )
  assert.ok(compaction.covered > 0, 'the coverage texture is non-zero where the strands are')
  assert.equal(run.placed, compaction.nodes, 'as many samples are placed as the pixels hold')
  assert.equal(run.allocated, run.placed, 'the room held them all: none was asked past it')
  assert.ok(compaction.argsMatch, 'the dispatch over the samples follows their count')
  assert.ok(material.compared > 0, 'materials were compared')
  assert.equal(material.controlPoints, 0, 'a material holds its control point and macro group')
  assert.equal(material.coverage, 0, 'a material holds the visibility’s coverage')
  assert.ok(material.depthGap < 1e-5, `a material’s depth is ${material.depthGap} off, relatively`)
  assert.ok(material.tangentGap <= 3, `a tangent is ${material.tangentGap} steps off the ribbon’s`)
  assert.ok(
    material.colorGap <= 3,
    `a colour is ${material.colorGap} steps off the default material’s`,
  )
  assert.ok(
    material.roughnessGap <= 3,
    `a roughness is ${material.roughnessGap} steps off the default`,
  )
  assert.equal(
    material.fixed,
    0,
    'specular, backlit, flags and lighting channels are the settings’',
  )
  assert.ok(gbuffer.pixels > 0, 'some pixels hold strands')
  // A strand's coverage is its radius over the least radius when it is thinner (the widening to the
  // least radius does not widen what it covers): the thin ribbon never covers a pixel wholly.
  if (scene === 'thin')
    assert.equal(gbuffer.patched, 0, 'a ribbon thinner than a pixel covers none wholly')
  else assert.ok(gbuffer.patched > 0, 'some pixels are covered wholly')
  assert.equal(
    gbuffer.nearestMismatches,
    0,
    'a pixel holds the depth of its nearest sample, 0 off the tiles',
  )
  assert.ok(
    gbuffer.depthGap < 1e-6,
    `the patched depth is ${gbuffer.depthGap} off the nearest sample’s`,
  )
  assert.equal(
    gbuffer.flagMismatches,
    0,
    'a surface under full coverage is unlit and casts a contact shadow',
  )
  assert.equal(gbuffer.untouchedMismatches, 0, 'every other pixel keeps its depth and flags')
}

test(
  'two wide ribbons: samples, transmittance, tiles and compaction match',
  { timeout: 180_000 },
  () => assertScene('wide', []),
)
test('two wide ribbons on the polyfills', { timeout: 180_000 }, () =>
  assertScene('wide', POLYFILLS),
)
test('a ribbon thinner than a sample is widened to the least radius', { timeout: 180_000 }, () =>
  assertScene('thin', []),
)
test('a ribbon thinner than a sample, on the polyfills', { timeout: 180_000 }, () =>
  assertScene('thin', POLYFILLS),
)

for (const off of [[], POLYFILLS])
  test(
    `a strand across the near plane leaves no crack between its triangles${off.length ? ', on the polyfills' : ''}`,
    { timeout: 180_000 },
    async () => {
      const { runs } = written(
        await runOnDawn(runHairVisibility, { scene: 'near', off, occluder: false }),
      )
      assert.equal(runs.gaps, 0, 'every row of samples the ribbon covers is one run')
      // From the point a metre away (row 242 of 360) down to the cut (row 312).
      assert.ok(runs.rows >= 60, `the ribbon covers ${runs.rows} rows`)
      assert.ok(runs.lastRow >= 305, `it reaches row ${runs.lastRow}, near the cut`)
    },
  )

test('strands behind an opaque surface write nothing', { timeout: 180_000 }, async () => {
  const run = written(
    await runOnDawn(runHairVisibility, { scene: 'wide', off: [], occluder: true }),
  )
  assert.equal(run.samples.covered, 0, 'no sample is written')
  assert.equal(run.samples.mismatches, 0)
  assert.equal(run.transmittance.touched, 0, 'the transmittance stays 1')
  assert.equal(run.placed, 0, 'no sample is placed')
  assert.equal(run.compaction.covered, 0, 'the coverage is zero')
  assert.equal(run.gbuffer.patched, 0, 'no surface is emptied')
  assert.equal(run.gbuffer.untouchedMismatches, 0, 'the depth and the flags stay')
})
