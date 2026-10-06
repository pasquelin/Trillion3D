// The water composite's mirror ray walks the depth bounds (`BOUNDED_SCREEN_REFLECTION_WGSL`),
// a reference session's unlifted, as every mirror ray (`screenReflection`): the reflection targets
// make them for a transmissive scene, and an image builds them where a mirror ray walks it
// (`mirrorWalksImage`): the water or a mirror receiver in view.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { createScreenReflection, mirrorWalksImage, reflectionPlan } from './gpu.ts'
import { reflectionBoundsPipelines } from './boundsPyramid.ts'
import { physical, sceneOf } from './receivers.fixture.ts'
import { contractLighting } from '../lighting/deferred/contractLighting.fixture.ts'
import { REFLECTION_SOURCE_PASS } from './sourcePass.ts'
import { REFLECTION_BOUNDS_MIPS_PASS } from '../texture/mipsPass.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { DEFERRED_LIGHTING_PASS } from '../stage/passLabels.ts'
import { encodeWaterPass } from '../webgpu/water/pass.ts'
import { createWaterPass } from '../webgpu/water/waterPass.ts'
import { prepared, replay, targets } from '../webgpu/water/pass.fixture.ts'
import { createWebgpuRowState } from '../webgpu/row/state.ts'

/** The frustum's verdict on the transparents of `rt` (`cullBlendHierarchy`): all kept or none. */
function inView(rt: WebgpuPagesRuntime, kept: boolean) {
  rt.blendState.transmissiveInView = kept ? rt.blendState.transmissive : 0
  rt.blendState.keepPacked = new Uint32Array([kept ? ~0 : 0])
}

test('a transmissive scene builds the depth bounds its water mirror walks on an image the water is in view, once', async () => {
  const h = await contractLighting()
  for (const reference of [false, true])
    for (const kept of [false, true]) {
      // A matte floor and a polished sea: no rough history, no cone, only the water's mirror ray.
      const rt = sceneOf([physical(1)], [physical(0)])
      rt.blendState.transmissive = 1
      inView(rt, kept)
      ;(rt as { context: Partial<WebgpuPagesRuntime['context']> }).context = {
        unboundedReflections: reference,
      }
      const plan = reflectionPlan(rt)
      assert.deepEqual(
        [plan.active, plan.rough, plan.cone, plan.mirror, plan.pyramid],
        [true, false, false, true, true],
      )
      const gpu = fakeDevice({ limits: { minUniformBufferOffsetAlignment: 256 } })
      const reflection = createScreenReflection(
        gpu.device,
        64,
        32,
        h.target,
        plan.active,
        plan.rough,
        plan.cone,
        plan.mirror,
      )
      assert.equal(reflection.mirror, true)
      assert.equal(reflection.pyramid?.radiance, false)
      reflection.update(new Float32Array(16), true, [64, 32], undefined, mirrorWalksImage(rt))
      h.passes.length = 0
      h.lighting.light(h.encoder, h.target, reflection)
      // Named as the reflection's, never as a material texture's mips (`mipsPass.ts`).
      const built = h.labels.filter((label) => label === REFLECTION_BOUNDS_MIPS_PASS).length
      assert.deepEqual(
        h.labels.filter((label) => label !== REFLECTION_BOUNDS_MIPS_PASS),
        [REFLECTION_SOURCE_PASS, DEFERRED_LIGHTING_PASS],
      )
      // In view, the whole chain once, before the lighting; off it, none.
      h.passes.length = 0
      reflection.pyramid!.encode(h.encoder, await reflectionBoundsPipelines(gpu.device))
      assert.equal(built, kept ? h.passes.length : 0)
      assert.ok(h.passes.length > 0)
      reflection.dispose()
    }
  h.lighting.dispose()
})

test('the water composite is never encoded on an image whose depth bounds were skipped', async () => {
  const { blendState, gpu } = prepared()
  targets(gpu)
  blendState.water = await createWaterPass(fakeDevice().device, {} as never, {} as never)
  const { rt, encoder } = replay(blendState, gpu)
  ;(rt as { layout: Partial<WebgpuPagesRuntime['layout']> }).layout = {
    rows: createWebgpuRowState([], 0),
  }
  for (const kept of [true, false]) {
    inView(rt, kept)
    const walks = mirrorWalksImage(rt)
    assert.equal(encodeWaterPass(rt, encoder), kept)
    assert.equal(walks, kept)
  }
})

test('an opaque mirror builds the depth bounds its walk reads, each image; a rough receiver walks none', async () => {
  // Past the mirror range, only the rough trace reads them (`roughHistory.test.ts`).
  const rough = reflectionPlan(sceneOf([physical(0.3)]))
  assert.deepEqual([rough.mirror, rough.pyramid], [false, true])
  const h = await contractLighting()
  const rt = sceneOf([physical(0)])
  const plan = reflectionPlan(rt)
  assert.deepEqual([plan.rough, plan.cone, plan.mirror, plan.pyramid], [false, false, true, true])
  const gpu = fakeDevice({ limits: { minUniformBufferOffsetAlignment: 256 } })
  const reflection = createScreenReflection(
    gpu.device,
    64,
    32,
    h.target,
    plan.active,
    plan.rough,
    plan.cone,
    plan.mirror,
  )
  // Among the rows drawn: a mirror ray walks the image.
  reflection.update(new Float32Array(16), true, [64, 32], undefined, mirrorWalksImage(rt))
  h.passes.length = 0
  h.lighting.light(h.encoder, h.target, reflection)
  assert.ok(
    h.labels.includes(REFLECTION_BOUNDS_MIPS_PASS),
    'the bounds are built before the lighting',
  )
  reflection.dispose()
  h.lighting.dispose()
})

test('a mirror walks the image only from a reader in it: a kept blended mirror, an impostor card', () => {
  // A blended mirror pane over a matte floor, no water: the plan holds a walk wherever it stands.
  const rt = sceneOf([physical(1)], [physical(1), physical(0)])
  rt.blendState.transmissive = 0
  rt.blendState.transmissiveInView = 0
  assert.equal(reflectionPlan(rt).mirror, true)
  // The frustum keeps the matte pane alone (bit 0), then the mirror (bit 1).
  for (const [bits, walks] of [
    [0b01, false],
    [0b10, true],
  ] as const) {
    rt.blendState.keepPacked = new Uint32Array([bits])
    assert.equal(mirrorWalksImage(rt), walks, `kept ${bits}`)
  }
  // A card draws a baked surface whose roughness no row tells: the bounds are built for it.
  rt.blendState.keepPacked = new Uint32Array([0b01])
  ;(rt.gpu as { impostors?: { count: number } }).impostors = { count: 3 }
  assert.equal(mirrorWalksImage(rt), true)
})
