// The sky occlusion the image will draw is decided at the frame's entry, from what the encoding decides on (`encodeSkyOcclusion`): the program asked there is the one the
// encoding binds, whatever the state the image before left; a transition (the sources arriving, a bounce switched on) is seen at the entry of the image it happens on.
import test from 'node:test'
import assert from 'node:assert/strict'
import { skyOcclusionPlanned } from './encodeSkyOcclusion.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** A runtime whose gate holds: the main view lit, a movable sky light that casts over a scene with distance-field objects, no bounce; the frame has its depth pyramid and normals. */
function runtime() {
  const main = { overrides: { lighting: true, skyLighting: true } }
  return {
    bounce: { wanted: false },
    views: { active: main, main },
    run: { diagnostic: 'beauty', depthDrawn: false },
    context: {},
    lights: { store: { unlit: false } },
    distanceFields: {
      scene: { meshes: { count: 1, generation: 0 } },
      skyLight: { light: { mobility: 'movable', castShadows: true } },
      occlusion: { read: undefined as unknown },
    },
    vis: { gpuHiz: { depth: () => ({}) } },
    gpu: { device: {}, surfaces: { views: () => [{}, {}] } },
  }
}
const planned = (rt: ReturnType<typeof runtime>) =>
  skyOcclusionPlanned(rt as unknown as WebgpuPagesRuntime)

test('the occlusion is planned at the entry whatever the last image left, and follows a transition at once', () => {
  const rt = runtime()
  assert.equal(planned(rt), true, 'planned before any image drew it')
  rt.distanceFields.occlusion.read = { bent: {}, params: {} }
  assert.equal(planned(rt), true, 'and the same where the image before read one')
  rt.bounce.wanted = true
  assert.equal(planned(rt), false, 'a bounce switched on: the probes carry the sky from this entry')
  rt.bounce.wanted = false
  rt.distanceFields.occlusion.read = undefined
  assert.equal(planned(rt), true, 'switched off again: planned before the encoding writes a read')
  const sources = rt.gpu.surfaces
  ;(rt.gpu as { surfaces?: unknown }).surfaces = undefined
  assert.equal(planned(rt), false, 'the frame lacks its normals: nothing to draw from')
  ;(rt.gpu as { surfaces?: unknown }).surfaces = sources
  assert.equal(planned(rt), true, 'they arrive: planned on that very entry')
})

test('no occlusion is planned where the gate fails: another view, no sky light that casts, no objects', () => {
  const rt = runtime()
  rt.views.active = { overrides: { lighting: true, skyLighting: true } }
  assert.equal(planned(rt), false, 'a view that is not the main one')
  const lit = runtime()
  lit.distanceFields.scene.meshes.count = 0
  assert.equal(planned(lit), false, 'no object in the distance fields')
})
