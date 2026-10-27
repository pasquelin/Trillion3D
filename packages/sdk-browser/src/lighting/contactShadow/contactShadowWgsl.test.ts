// Where the light term holds the contact shadows' code: the opaque lit passes' programs that do not
// say `contactless`, never a translucent one, and without the shading models' rays and density where
// the pass holds no model.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { declaredLightWgsl } from '../direct/lightLoopWgsl.ts'
import { declaredLightingSplitWgsl } from '../direct/declaredLightingWgsl.ts'
import { FULL_CONTRACT } from '../deferred/contractCuts.ts'
import { translucentLitKey } from '../../blend/shader.ts'
import { contactShadowWgsl } from './contactShadowWgsl.ts'

test('a program without the models holds neither the eye’s nor the hair’s rays nor the density', () => {
  const bare = contactShadowWgsl(false).text
  for (const left of ['pixelModel==', 'subsurfaceDensity(', 'subsurfaceColor', 'thinSurface'])
    assert.ok(!bare.includes(left), left)
  const models = contactShadowWgsl(true).text
  for (const kept of ['pixelModel==', 'subsurfaceDensity(', 'subsurfaceColor', 'thinSurface'])
    assert.ok(models.includes(kept), kept)
})

test('the light term holds the ray unless its key says contactless, and a translucent term never does', () => {
  const holds = (code: string) => code.includes('fn contactShadow(')
  assert.ok(holds(wgslModule(declaredLightWgsl(FULL_CONTRACT))))
  assert.ok(!holds(wgslModule(declaredLightWgsl({ ...FULL_CONTRACT, contactless: true }))))
  // The translucent layers bind neither the scene's depth nor its flags: their key says contactless.
  assert.ok(!holds(wgslModule(declaredLightingSplitWgsl(translucentLitKey(FULL_CONTRACT, true)))))
})
