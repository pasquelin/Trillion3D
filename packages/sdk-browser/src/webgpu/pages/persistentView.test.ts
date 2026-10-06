// #1097: the persistent-view base. A view drawn beside the main one every frame keeps its own hold,
// Hi-Z pyramid, target grant, anti-aliasing history and effect chain: the main view's hold is never
// reset by it, and once both are sized neither asks the device anything.
import test from 'node:test'
import assert from 'node:assert/strict'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { EffectChain } from '../../../../sdk-core/src/world/effect/chain.ts'
import { effect } from '../../../../sdk-core/src/world/effect/index.ts'
import { camera, flushedGpuScene, quadScene } from './testScenes.fixture.ts'
import { awayCamera, drawnQuad } from './drawnQuad.fixture.ts'
import { flushWebgpuPages } from './render/flush.ts'
import { renderWebgpuPages } from './render/render.ts'
import { addWebgpuView, removeWebgpuView, renderWebgpuView } from './state/persistentView.ts'
import type { WebgpuPagesBackend } from './runtime.ts'
import { TAA_STILL_FRAMES } from '../../taa/stillFrames.fixture.ts'
import { families } from '../../host/families.ts'

// The effects' code, which a frame that draws them waits for (`familyUse.ts`), arrived.
await families.effects.load()

const RECT = { x: 4, y: 4, width: 16, height: 8 }

test('drawing another view every frame never resets the main view’s hold, nor asks the device', async () => {
  installGpuGlobals()
  // The blend-only quad, whose still view holds (#198).
  const scene = quadScene()
  scene.metadata.primitives[0].pass = 'clustered-blend'
  scene.material.transparent = true
  scene.material.opacity = 0.5
  const { backend, textures } = await flushedGpuScene(scene)
  const side = await (backend as WebgpuPagesBackend).addView(RECT)
  /** One host frame: the main view, then the side one; whether the main view was held. */
  const frame = async () => {
    backend.render(camera())
    const held = backend.metrics().frameHeld
    side.render(awayCamera())
    await backend.flush!()
    return held
  }
  let frames = 0
  while (!(await frame())) assert.ok(frames++ < TAA_STILL_FRAMES + 8, 'the main view holds')
  const made = textures.length
  for (let i = 0; i < 3; i++) assert.equal(await frame(), true, 'and stays held')
  assert.equal(textures.length, made, 'no view is sized again: no pyramid, no target is made')
  await side.release()
  await backend.dispose()
})

test('a target grant lands on the view that asked for it, whichever is drawn', async () => {
  const { rt } = await drawnQuad(false)
  const side = await addWebgpuView(rt, RECT)
  renderWebgpuView(rt, side, awayCamera())
  assert.equal(rt.views.active, rt.views.main, 'the main view is drawn again at once')
  const asked = side.gpu.targetGrant
  assert.ok(asked && rt.gpu.targetGrant === undefined, 'the side view asked, not the main one')
  await asked.done
  assert.equal(side.gpu.targetGrant, undefined, 'answered on the side view')
  assert.deepEqual(side.gpu.targetSize, [16, 8])
  assert.deepEqual(rt.gpu.targetSize, [32, 32], 'the main view keeps its targets')
  await removeWebgpuView(rt, side)
})

test('a persistent view accumulates its own history, the main view’s left as it was', async () => {
  const { rt } = await drawnQuad(true)
  const main = rt.gpu.temporal!,
    frame = { ...main.frame }
  const side = await addWebgpuView(rt, RECT)
  for (let i = 0; i < 2; i++) {
    renderWebgpuView(rt, side, camera())
    await flushWebgpuPages(rt)
  }
  const own = side.gpu.temporal
  assert.ok(own && own !== main, 'a pass of its own')
  assert.equal(own.frame.active, true, 'no capture: it accumulates')
  assert.deepEqual({ ...main.frame }, frame, 'the main view’s history is untouched')
  assert.equal(rt.gpu.temporal, main)
  await removeWebgpuView(rt, side)
})

test('a persistent view is no capture: it draws the effect chain, with its own targets', async () => {
  const effects = new EffectChain().add(effect.bloom())
  const { rt } = await drawnQuad(true, { effects })
  const chain = rt.gpu.effects
  assert.ok(chain, 'the main view draws the chain')
  const side = await addWebgpuView(rt, RECT)
  for (let i = 0; i < 2; i++) {
    renderWebgpuView(rt, side, camera())
    await flushWebgpuPages(rt)
  }
  assert.equal(rt.capture.capturing, false)
  assert.ok(side.gpu.effects && side.gpu.effects !== chain, 'its chain, at its own size')
  renderWebgpuPages(rt, camera())
  assert.equal(rt.gpu.effects, chain, 'the main view keeps its own')
  await removeWebgpuView(rt, side)
})
