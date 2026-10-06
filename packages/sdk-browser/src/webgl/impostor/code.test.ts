// The WebGL2 impostor tier loads its code from the impostor family both renderers share, so
// the CDN core stays within its budget. A cache without baked impostors makes no tier; one with
// them makes it where the backend prepares, so its first plan already asks the atlas.
import test from 'node:test'
import assert from 'node:assert/strict'
import { families } from '../../host/families.ts'
import { createTestContext } from '../core/testContext.fixture.ts'
import {
  ATLAS_URLS,
  engineAt,
  impostorScene,
  impostorSection,
  VIEWPORT,
} from '../../impostor/section.fixture.ts'
import { webglImpostorTier } from './code.ts'

test('the WebGL2 tier is made by a baked cache only, at its prepare, and plans its first image', async () => {
  const { fixture, roots, reader, asked } = impostorScene()
  const gate = { resourcesChanged: () => {} }
  const session = (impostors: unknown) =>
    ({
      metadata: { impostors },
      readTextureLevel: reader,
      webglContext: createTestContext().gl,
    }) as unknown as Parameters<typeof webglImpostorTier>[0]
  assert.equal(
    webglImpostorTier(session({ baked: 0 }), roots, gate, () => 1 << 20),
    undefined,
  )
  assert.equal(families.impostors.arrived, false, 'a cache without cards fetches nothing')
  const tier = webglImpostorTier(session(impostorSection), roots, gate, () => 1 << 20)!
  await tier.prepare()
  assert.equal(families.impostors.arrived, true, 'the prepare awaits the code')
  tier.plan(engineAt(200), VIEWPORT)
  assert.deepEqual(
    asked.map((request) => request.url),
    ATLAS_URLS,
    'the first image plans and asks the atlas',
  )
  tier.dispose()
  fixture.geometry.dispose()
})
