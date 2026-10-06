// A card program the WebGL2 context refuses — a shader that does not compile, a program that
// does not link — is told once and switches no root to a card: the root keeps its clusters and the
// images draw on, no card drawn and nothing thrown, as without the impostor code. Fails without the
// fallback: the plan switched the root and every draw threw on its card program.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTestContext } from '../core/testContext.fixture.ts'
import { WebglClusterRenderer } from '../cluster/renderer.ts'
import { readDegraded } from '../cluster/validation.ts'
import { createHostDrawCamera, readHostDrawCamera } from '../../camera/world.ts'
import { frontCamera } from '../../page/selection/dag.fixture.ts'
import type { BackendDiagnostic } from '../../backend/types.ts'
import {
  cutAt,
  engineAt,
  impostorScene,
  impostorSection,
  settle,
  VIEWPORT,
} from '../../impostor/section.fixture.ts'
import { webglImpostorTier } from './code.ts'

for (const refused of ['getShaderParameter', 'getProgramParameter'])
  test(`a card program refused by ${refused} leaves every root its clusters`, async () => {
    // The cluster program is made first and compiles; the card programs are refused.
    let refuse = false
    const context = createTestContext({
      answers: { getExtension: () => ({}), [refused]: () => !refuse },
    })
    const renderer = new WebglClusterRenderer(
      context.gl,
      readDegraded(() => {}),
    )
    refuse = true
    const { fixture, roots, reader } = impostorScene()
    const told: BackendDiagnostic[] = []
    const session = {
      metadata: { impostors: impostorSection },
      readTextureLevel: reader,
      webglContext: context.gl,
      onDiagnostic: (diagnostic: BackendDiagnostic) => told.push(diagnostic),
    } as unknown as Parameters<typeof webglImpostorTier>[0]
    const tier = webglImpostorTier(session, roots, { resourcesChanged: () => {} }, () => 1 << 20)!
    await tier.prepare()
    renderer.cards = tier.cards
    const from = context.calls.length
    // Two images, the second after the first's atlas could land: the root stays whole in both.
    for (let image = 0; image < 2; image++) {
      tier.plan(engineAt(200), VIEWPORT)
      assert.equal(roots[0].mark, undefined, 'no card switch')
      assert.ok(cutAt(roots, 200).shown.length > 0, "the root's clusters are drawn")
      const camera = readHostDrawCamera(createHostDrawCamera(), frontCamera(200, 5000))
      assert.doesNotThrow(() => renderer.draw([], { lights: [] }, camera, true, true))
      await settle()
    }
    const calls = context.calls.slice(from).map((call) => call.name)
    assert.ok(!calls.includes('drawArraysInstanced'), 'no card drawn')
    assert.deepEqual(
      told.map((diagnostic) => diagnostic.phase),
      ['impostor-card-program-failed'],
      'told once',
    )
    tier.dispose()
    fixture.geometry.dispose()
  })
