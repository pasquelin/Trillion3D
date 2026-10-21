// The transparent occlusion test is conservative, cluster by cluster. The bench scene with twelve
// instances and thirty poses along the bench trajectory; after each frame, every transparent
// cluster the test removed must stay rejected by the engine's double-precision reference on the
// same inputs (`transparentOcclusionPage.ts`). Zero violations is the only acceptable count.
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DEFAULT_SCENE, sceneDerived } from '../../../bench/runner/assets/scene.ts'
import { cacheHoldsBlend } from '../../../bench/runner/assets/cacheManifest.ts'
import { loadPage, runOnDawn } from '../../kit/device/onDawn.ts'

const POSES = 30
const cache = join(sceneDerived(DEFAULT_SCENE), 'native/full')

test('the transparent occlusion test rejects no cluster the reference sees, on every pose', async () => {
  const manifest = join(cache, 'manifest.json')
  assert.ok(existsSync(manifest), `setup: the bench scene's cache is missing (${manifest})`)
  const page = (await loadPage(
    resolve(import.meta.dirname, 'transparentOcclusionPage.ts'),
    'transparentOcclusion',
  )) as typeof import('./transparentOcclusionPage.ts')
  const pageErrors: string[] = []
  const reading = await runOnDawn(
    page.auditPoses,
    {
      manifestUrl: pathToFileURL(manifest).href,
      width: 1012,
      height: 1000,
      instances: 12,
      pixelError: 1,
      maxPages: 100000,
      warmup: 8,
      poses: POSES,
    },
    pageErrors,
  )
  console.log(JSON.stringify({ ...reading, frames: reading.frames?.slice(-3) }, null, 2))
  assert.equal(reading.error ?? null, null, String(reading.error))
  assert.deepEqual(pageErrors, [])
  assert.deepEqual(reading.events, [], 'the engine reported a fallback or an error')
  const { frames, occlusion, occlusionViolations } = reading
  assert.ok(frames && occlusion && occlusionViolations)
  assert.equal(frames.length, POSES, 'every pose is audited')
  assert.deepEqual(
    occlusionViolations,
    [],
    'removed transparent clusters stay visible to the reference',
  )
  // A cache without a transparent cluster leaves the test nothing to examine.
  if (await cacheHoldsBlend(cache)) {
    assert.ok(occlusion.examined > 0, 'no transparent cluster was examined')
    assert.ok(occlusion.rejected > 0, 'the transparent occlusion test rejected nothing')
    assert.equal(occlusion.violations, 0, 'transparent clusters wrongly rejected')
  } else assert.equal(occlusion.examined, 0, 'transparent clusters examined with none cached')
})
