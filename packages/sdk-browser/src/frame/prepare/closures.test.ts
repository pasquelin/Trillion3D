// The closures per pixel at the frame: the project's limit the programs are compiled for, the most closures a view's surfaces ask, and the
// closure slices the drawn view's record holds for it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { limitOf } from '../../materials/closures/closureLimit.ts'
import { createSurfaceBuffer } from '../../materials/surface/surfaceAllocation.ts'
import {
  followClosureLayers,
  followClosureLimit,
  mostClosures,
  supportsMultipleClosures,
  viewClosureMax,
} from './closures.ts'
import { isProgram, programOf } from '../../materials/graph/surfaceProgram.ts'
import { closureCountOf } from '../../materials/closures/viewClosures.ts'
import { runtime as fixtureRuntime } from './targets.fixture.ts'
import { frameTargetAllocation, sceneBlends } from './targetAllocation.ts'
import { reflectionBytes } from '../../lighting/reflections/gpu.ts'
import { closureBytes } from '../../materials/surface/surfaceBuffer.ts'
import { closuresHeld } from '../../materials/surface/surfaceOutputs.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** A surface of `count` closures (a sum of `count` slabs, the project's limit permitting). */
function surfaceOf(count: number) {
  const g = material.graph('surface')
  let root = g.slab({ baseColor: g.constant(1, 0, 0) })
  for (let i = 1; i < count; i++)
    root = g.addClosures(root, g.slab({ baseColor: g.constant(i, 0, 0) }))
  g.closures(root)
  return { graph: g }
}

/** The part of the runtime the closures read. */
function runtime(settings: Record<string, unknown>, surfaces: unknown[]) {
  const forgotten = { count: 0 }
  const { device } = fakeDevice({ limits: { maxTextureDimension2D: 4096 } })
  const rt = {
    context: settings,
    run: { frame: 0 },
    gpu: { device, surfaces: undefined as unknown, targetBytes: 0 },
    vis: {
      shadeCensus: { revision: 1, surfaces },
      materialTable: { forget: () => forgotten.count++ },
    },
  }
  return { rt: rt as unknown as WebgpuPagesRuntime, forgotten, gpu: rt.gpu, device }
}

test("the project's limit is read once a frame, and a change writes every record again", () => {
  const { rt, forgotten } = runtime({ closuresPerPixel: 2 }, [surfaceOf(3)])
  followClosureLimit(rt)
  assert.equal(limitOf(rt.vis), 2)
  assert.equal(forgotten.count, 0, 'the first frame has no record to write again')
  ;(rt.context as unknown as Record<string, unknown>).closuresPerPixel = 3
  followClosureLimit(rt)
  assert.equal(forgotten.count, 1)
  followClosureLimit(rt)
  assert.equal(forgotten.count, 1, 'the same limit writes nothing again')
  ;(rt.context as unknown as Record<string, unknown>).closuresPerPixel = 8
  followClosureLimit(rt)
  assert.equal(limitOf(rt.vis), 8)
  assert.equal(forgotten.count, 2)
  // Another runtime sets its own limit at its frame, the first one's records are not written again for it.
  const other = runtime({ closuresPerPixel: 5 }, [surfaceOf(3)])
  followClosureLimit(other.rt)
  assert.equal(limitOf(other.rt.vis), 5)
  followClosureLimit(rt)
  assert.equal(limitOf(rt.vis), 8)
  assert.equal(forgotten.count, 2)
  // No surface with a closure tree: a change of the limit writes nothing again.
  const plain = runtime({ closuresPerPixel: 2 }, [{ graph: undefined }])
  followClosureLimit(plain.rt)
  ;(plain.rt.context as unknown as Record<string, unknown>).closuresPerPixel = 3
  followClosureLimit(plain.rt)
  assert.equal(plain.forgotten.count, 0)
})

test("a view keeps the most closures its surfaces ask, within the project's, or the project's alone", () => {
  const surfaces = [surfaceOf(1), surfaceOf(3), { graph: undefined }]
  const { rt } = runtime({ closuresPerPixel: 4 }, surfaces)
  followClosureLimit(rt)
  assert.equal(viewClosureMax(rt), 3)
  // A project that keeps two closures simplifies the sum of three until it fits: its root blended, one closure.
  ;(rt.context as unknown as Record<string, unknown>).closuresPerPixel = 2
  followClosureLimit(rt)
  assert.equal(viewClosureMax(rt), 1)
  // Off, the count is not taken from the materials: the project's.
  ;(rt.context as unknown as Record<string, unknown>).closureCountFromMaterial = false
  ;(rt.context as unknown as Record<string, unknown>).closuresPerPixel = 5
  followClosureLimit(rt)
  assert.equal(viewClosureMax(rt), 5)
  // No surface of several closures: one closure, nothing held.
  const plain = runtime({}, [{ graph: undefined }])
  assert.equal(viewClosureMax(plain.rt), 1)
})

test('a graph whose closure tree changes moves the most at once, the census not having moved', () => {
  const surface = surfaceOf(1)
  const { rt } = runtime({ closuresPerPixel: 4 }, [surface])
  followClosureLimit(rt)
  assert.equal(viewClosureMax(rt), 1)
  const g = surface.graph
  g.closures(g.addClosures(g.slab({}), g.slab({})))
  // The shapes are summed once an image: the tree set between two images is read by the next one, and the sum is not taken again within one.
  assert.equal(viewClosureMax(rt), 1)
  ;(rt as unknown as { run: { frame: number } }).run.frame++
  assert.equal(viewClosureMax(rt), 2)
  assert.equal(mostClosures(rt), 2)
})

test("the drawn view's record holds the closure slices its most asks, and is remade alone when that changes", () => {
  const { rt, gpu, device } = runtime({ closuresPerPixel: 4 }, [surfaceOf(3)])
  followClosureLimit(rt)
  gpu.surfaces = createSurfaceBuffer(device, 16, 16)
  const single = gpu.surfaces as ReturnType<typeof createSurfaceBuffer>
  followClosureLayers(rt)
  const three = gpu.surfaces as ReturnType<typeof createSurfaceBuffer>
  assert.notEqual(three, single)
  assert.equal(three.closures, 3)
  assert.equal(three.words === single.words, false)
  assert.equal(three.lobes, single.lobes, 'the lobes target is kept')
  assert.equal(gpu.targetBytes, three.allocationBytes - single.allocationBytes)
  followClosureLayers(rt)
  assert.equal(gpu.surfaces, three, 'nothing changes while the most holds')
  ;(rt.context as unknown as Record<string, unknown>).closuresPerPixel = 1
  followClosureLimit(rt)
  followClosureLayers(rt)
  assert.equal((gpu.surfaces as typeof three).closures, 1)
})

test("the frame's bytes count the closure slices the view's most asks, as the record that holds them does", () => {
  const { rt } = fixtureRuntime()
  const size = { width: 64, height: 32, renderWidth: 64, renderHeight: 32, apart: false }
  ;(rt.vis as { shadeCensus: unknown }).shadeCensus = { revision: 1, surfaces: [] }
  const one = frameTargetAllocation(rt, size)
  ;(rt.vis as { shadeCensus: unknown }).shadeCensus = { revision: 2, surfaces: [surfaceOf(3)] }
  followClosureLimit(rt)
  assert.equal(viewClosureMax(rt), 3)
  // Beside the slices, the reflection holds two layers of its target and the traced reflection (flags, grids, resolved pixels) of each closure past the first.
  const reflection = (closures: number) =>
    reflectionBytes(64, 32, sceneBlends(rt), rt.setup.reflectionStatistics, closures)
  assert.equal(
    frameTargetAllocation(rt, size) - one,
    closureBytes(64, 32, closuresHeld(3)) + reflection(3) - reflection(1),
  )
  assert.ok(closureBytes(64, 32, closuresHeld(3)) > 0)
  assert.ok(reflection(3) > reflection(1))
})

test('each runtime compiles its programs for its own limit, read from what a caller receives of it', () => {
  const surface = surfaceOf(3)
  const small = runtime({ closuresPerPixel: 1 }, [surface]),
    large = runtime({ closuresPerPixel: 8 }, [surface])
  assert.equal(limitOf(small.rt.vis), 4, 'the setting default before the first frame')
  followClosureLimit(small.rt)
  followClosureLimit(large.rt)
  const countFor = (rt: WebgpuPagesRuntime) => {
    const program = programOf(surface, undefined, limitOf(rt.vis))
    assert.ok(isProgram(program))
    return closureCountOf(program.compiled)
  }
  // One program for each limit, the same graph; neither runtime reads the other's.
  assert.equal(countFor(small.rt), 1)
  assert.equal(countFor(large.rt), 3)
  assert.equal(countFor(small.rt), 1)
})

test('the readers evaluate several closures only where the drawn view holds more than one', () => {
  const one = runtime({ closuresPerPixel: 4 }, [surfaceOf(1), { graph: undefined }])
  followClosureLimit(one.rt)
  assert.equal(supportsMultipleClosures(one.rt), false)
  const several = runtime({ closuresPerPixel: 4 }, [surfaceOf(3)])
  followClosureLimit(several.rt)
  assert.equal(supportsMultipleClosures(several.rt), true)
  // The project held to one closure: no view holds more, whatever the materials ask.
  const held = runtime({ closuresPerPixel: 1 }, [surfaceOf(3)])
  followClosureLimit(held.rt)
  assert.equal(supportsMultipleClosures(held.rt), false)
})
