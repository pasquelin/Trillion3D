// The diff of the instances' boxes (`castDiff.ts`) is asked when the event the reference follows may
// have happened — a placement's world was written, its word was written, the roots grew — and never otherwise; the
// first diff of a memory made anew only remembers; what it followed is remembered when it is
// encoded, and not before its kernel is compiled. A still scene pays no thread. And what it names,
// as the reference invalidates an instance: the box a placement leaves in the layer it was cached
// in, the box it enters in the layer it is cached in now (`castDiffWgsl.ts`, run in JavaScript).
import { ComputeRun } from '../../../gpu/core/lazyComputePass.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import {
  SHADOW_CHANGE_BOXES,
  createShadowChanges,
} from '../../../../../sdk-core/src/scene/light/shadow/changes.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { encodeCastDiff, followRoots, prepareCastDiff } from './castDiff.ts'
import { ROOT_BOX_DOUBLES } from '../../../placement/roots/rootWorldSends.ts'
import { createShadowMobility } from './mobility.ts'

/** A runtime of `roots` placements of one page each, their boxes and worlds on buffers, no world written yet. */
function runtime(roots = 6) {
  const { device } = fakeDevice()
  const selectionRoots = Array.from({ length: roots }, () => ({
    world: { elements: new Float64Array(16) },
    pages: [{}],
  }))
  const boxes = device.createBuffer({
    size: 64 * 8 * ROOT_BOX_DOUBLES,
    usage: GPUBufferUsage.STORAGE,
  })
  const worlds = device.createBuffer({ size: 64 * 8 * 16, usage: GPUBufferUsage.STORAGE })
  const rt = {
    layout: { selectionRoots, placement: { packedCount: roots } },
    lights: { mobility: createShadowMobility(), changes: createShadowChanges(SHADOW_CHANGE_BOXES) },
    rootWorlds: { held: roots, boxes, worlds },
    rootBoxes: { written: 0 },
    vis: { rootOffsets: { rowOf: () => undefined } },
    context: {},
    gpu: { device },
  } as unknown as WebgpuPagesRuntime
  return { rt, device, selectionRoots }
}

test('a memory made anew only remembers; later the diff is asked by what changed alone', async () => {
  const { rt, device, selectionRoots } = runtime()
  const { lights } = rt
  const encode = (ask: NonNullable<ReturnType<typeof followRoots>>) => {
    const steps = new ComputeRun().begin(device.createCommandEncoder())
    encodeCastDiff(rt, device, steps, ask)
    steps.end()
  }
  const first = followRoots(rt, device)
  assert.ok(first, 'the first frame asks')
  assert.equal(first.quiet, true, 'a memory made anew names no placement')
  assert.equal(lights.changes.count(), 1, 'and the pages every caster stands in go stale once')
  // The kernel compiling: nothing is remembered, the next frame asks again.
  encode(first)
  assert.equal(followRoots(rt, device)!.diff, true, 'not encoded: asked again')
  await prepareCastDiff(device)
  const again = followRoots(rt, device)!
  encode(again)
  assert.equal(followRoots(rt, device)!.diff, false, 'a still scene: no diff')
  // The roots pass wrote worlds: the placements it moved may have moved.
  rt.rootBoxes!.written = 1
  const moved = followRoots(rt, device)
  assert.ok(
    moved && !moved.quiet && moved.roots === 6,
    'a world written: the diff, over every placement',
  )
  assert.ok(lights.casts!.appended && lights.casts!.pending >= 12, 'room for two boxes each')
  encode(moved)
  assert.equal(followRoots(rt, device)!.diff, false)
  // A placement's word: it started moving, still at the same revision.
  lights.mobility.move(3, selectionRoots[3].world.elements, true)
  assert.equal(followRoots(rt, device)!.diff, true, 'a word written: the diff')
})

test('the roots grown ask the diff, and the memory keeps the placements it held', async () => {
  const { rt, device, selectionRoots } = runtime(4)
  await prepareCastDiff(device)
  const first = followRoots(rt, device)!
  const steps = new ComputeRun().begin(device.createCommandEncoder())
  encodeCastDiff(rt, device, steps, first)
  steps.end()
  assert.equal(followRoots(rt, device)!.diff, false)
  const memory = rt.lights.casts!.state
  selectionRoots.push({ world: { elements: new Float64Array(16) }, pages: [{}] })
  rt.rootWorlds!.held = 5
  const grown = followRoots(rt, device)
  assert.ok(grown && !grown.quiet, 'a new placement arrives: it is named')
  assert.ok(rt.lights.casts!.stateRoots >= 5, 'the memory holds room for it')
  assert.notEqual(rt.lights.casts!.state, memory, 'made larger')
})
