import test from 'node:test'
import assert from 'node:assert/strict'
import {
  drawFrameAt,
  frameSizeOf,
  renderMipBias,
  renderPixelRatio,
  type FrameSize,
} from './renderScale.ts'
import { renderExtent } from '../../../frame/renderScaleOption.ts'
// The old controller's instant drop sets the scale drawn; the rules tested hold under either.
import { createScaleControl } from '../../../frame/scaleControl.ts'
import { lowered } from '../../../frame/scaleFit.fixture.ts'
import type { RenderScale } from '../../../frame/renderScaleOption.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

const DISPLAY = [3456, 2234]

/** A view that accumulates in the beauty view, the page asking `scale`, its targets made at
 *  `allocated` for the boss's display; `extents` hears what the Hi-Z pyramid is built over. */
function runtime(scale: RenderScale | undefined, allocated = DISPLAY, apart = true) {
  const extents: number[][] = [],
    colorTexture = {}
  const rt = {
    setup: { viewport: DISPLAY, pixelRatio: () => 2 },
    context: {},
    scale: createScaleControl(scale),
    gpu: {
      temporal: { upscales: () => true },
      temporalWanted: true,
      targetSize: [...allocated],
      allocatedSize: [...allocated],
      displaySize: DISPLAY,
      colorTexture,
      displayTexture: apart ? {} : colorTexture,
    },
    run: { diagnostic: 'beauty' },
    vis: { visEnabled: true, gpuHiz: { extent: (w: number, h: number) => extents.push([w, h]) } },
  } as unknown as WebgpuPagesRuntime
  return { rt, extents }
}

const sizeOf = (rt: WebgpuPagesRuntime) => ({ ...frameSizeOf(rt, {} as FrameSize) })

test('a render axis is the display at native size, else a multiple of eight', () => {
  assert.equal(renderExtent(1117, 1), 1117, 'native size keeps an odd axis as it is')
  assert.equal(renderExtent(3456, 0.5), 1728)
  assert.equal(renderExtent(2234, 0.5), 1120)
  assert.equal(renderExtent(3456, 0.67), 2312)
  assert.equal(renderExtent(12, 0.5), 8, 'never below eight')
})

// #832: the targets start at the bounds' maximum, the display colour apart.
test('the targets start at the maximum, apart from the display wherever a scale may drop', () => {
  const native = { width: 3456, height: 2234, renderWidth: 3456, renderHeight: 2234 }
  assert.deepEqual(sizeOf(runtime('auto').rt), { ...native, apart: true })
  assert.deepEqual(sizeOf(runtime({ min: 0.6, max: 0.8 }).rt), {
    ...native,
    renderWidth: 2768,
    renderHeight: 1784,
    apart: true,
  })
  assert.deepEqual(sizeOf(runtime(0.5).rt), {
    ...native,
    renderWidth: 1728,
    renderHeight: 1120,
    apart: true,
  })
  assert.deepEqual(sizeOf(runtime(1).rt), { ...native, apart: false }, 'fixed at 1: as before')
  assert.deepEqual(sizeOf(runtime(undefined).rt), { ...native, apart: false })
})

// #816: only where the temporal resolve reconstructs the display is the frame drawn below it.
test('the frame is drawn below the display only when the temporal resolve reconstructs it', () => {
  const changes: [string, (view: WebgpuPagesRuntime) => void][] = [
    ['a diagnostic view', (view) => (view.run.diagnostic = 'normals' as never)],
    ['no pass: a capture view', (view) => (view.gpu.temporal = undefined)],
    ['the fallback draw', (view) => (view.vis.visEnabled = false)],
    ['a GPU variant', (view) => (view.context.diagnosticGpuVariant = 'raster-compute' as never)],
    ['resolves compiling', (view) => Object.assign(view.gpu.temporal!, { upscales: () => false })],
  ]
  for (const [what, change] of changes) {
    const { rt } = runtime(0.5)
    change(rt)
    const size = sizeOf(rt)
    assert.deepEqual([size.renderWidth, size.apart], [3456, false], what)
  }
  // Switched off, the pass draws at the display's size and keeps the display colour apart, so a
  // switch at the display's scale remakes no target (decision 14).
  const { rt } = runtime(0.5)
  rt.gpu.temporalWanted = false
  const size = sizeOf(rt)
  assert.deepEqual([size.renderWidth, size.apart], [3456, true], 'the pass switched off')
})

// Decision 14: switched off, the pass draws at the display's size; back on, the targets are made at
// the bounds' maximum (#831), the display's own under `'auto'`: no switch, nor any move of the
// controller, remakes a target.
test('switched back on, the targets made off stay, whatever the controller asks', () => {
  const { rt } = runtime('auto')
  rt.gpu.temporalWanted = false
  assert.equal(sizeOf(rt).renderWidth, 3456)
  rt.gpu.temporalWanted = true
  assert.equal(sizeOf(rt).renderWidth, 3456, 'on again: the same targets')
  lowered(rt.scale, 40)
  assert.equal(rt.scale.wanted(), 0.5)
  assert.equal(sizeOf(rt).renderWidth, 3456, 'the controller moved: nothing remade')
})

// #831: the scale asked was read back, not the size drawn — a full-scale image drawn in targets made
// at a maximum of 0.8, or one the targets held below the controller, was told as the scale asked,
// and measured as the controller's.
test('the scale read back is the size drawn; one the targets hold smaller is not measured', () => {
  const { rt } = runtime({ min: 0.5, max: 0.8 }, [2768, 1784])
  drawFrameAt(rt, 1, true)
  assert.deepEqual(rt.gpu.targetSize, [2768, 1784])
  assert.deepEqual([rt.scale.drawn, rt.scale.steered], [2768 / 3456, false])
  drawFrameAt(rt, 0.6, true)
  assert.deepEqual([rt.scale.drawn, rt.scale.steered], [0.6, true], 'held whole: the scale asked')
  // Targets refused: made an eighth lower, the controller's scale held there with them.
  for (let frame = 0; frame < 4; frame++) rt.scale.tick((frame * 1000) / 120)
  assert.equal(rt.scale.wanted(), 0.8)
  assert.equal(rt.scale.capMemory('3456x2234'), true)
  assert.equal(rt.scale.wanted(), 0.675, 'the controller asks no more than the targets hold')
  rt.gpu.allocatedSize = [renderExtent(3456, 0.675), renderExtent(2234, 0.675)]
  drawFrameAt(rt, rt.scale.wanted(), true)
  assert.deepEqual([rt.scale.drawn, rt.scale.steered], [0.675, true], 'drawn whole, measured')
  for (let frame = 4; frame < 16; frame++) rt.scale.tick((frame * 1000) / 120)
  rt.scale.observe(4, 0.675)
  assert.equal(rt.scale.wanted(), 0.675, 'cheap frames rise no higher than the targets')
  rt.scale.uncapMemory()
  assert.equal(rt.scale.allocated('3456x2234'), 0.8, 'the room came back')
})

test('an image draws at the scale asked, the controller starting at its maximum', () => {
  assert.equal(runtime('auto').rt.scale.wanted(), 1)
  assert.equal(runtime(0.6).rt.scale.wanted(), 0.6)
  assert.equal(runtime({ min: 0.5, max: 0.8 }).rt.scale.wanted(), 0.8)
})

// #831: targets made on a ladder of eighths were remade at each rung the controller crossed, the
// frame held for the memory and the history restarted: a flicker as the camera starts or stops.
test('the targets are made at the bounds maximum whatever the controller draws in them', () => {
  const { rt } = runtime('auto')
  const full = { width: 3456, height: 2234, renderWidth: 3456, renderHeight: 2234, apart: true },
    clock = lowered(rt.scale, 12)
  assert.ok(rt.scale.wanted() < 0.875, `a 12 ms frame at 120 Hz draws at ${rt.scale.wanted()}`)
  assert.deepEqual(sizeOf(rt), full)
  lowered(rt.scale, 40, clock)
  assert.equal(rt.scale.wanted(), 0.5, 'a 40 ms frame drops to the minimum')
  assert.deepEqual(sizeOf(rt), full, 'nothing to remake')
  const bounded = runtime({ min: 0.5, max: 0.8 }).rt
  assert.deepEqual(sizeOf(bounded), { ...full, renderWidth: 2768, renderHeight: 1784 })
})

test('a scale change within the targets draws in them in place, the Hi-Z pyramid over the same size', () => {
  const { rt, extents } = runtime('auto')
  drawFrameAt(rt, 0.5)
  assert.deepEqual(rt.gpu.targetSize, [1728, 1120])
  assert.deepEqual(rt.gpu.allocatedSize, DISPLAY, 'nothing remade')
  assert.equal(rt.scale.drawn, 0.5, 'the read-back is the scale drawn')
  drawFrameAt(rt, 1)
  assert.deepEqual(rt.gpu.targetSize, DISPLAY)
  assert.equal(rt.scale.drawn, 1)
  assert.deepEqual(extents, [[1728, 1120], DISPLAY])
})

test('a fixed scale is honoured, and targets without a display apart draw whole', () => {
  const fixed = runtime(0.6, [2072, 1344]).rt
  drawFrameAt(fixed, fixed.scale.wanted())
  assert.deepEqual(fixed.gpu.targetSize, [2072, 1344])
  assert.equal(fixed.scale.drawn, 0.6)
  const whole = runtime('auto', DISPLAY, false).rt
  drawFrameAt(whole, 0.5)
  assert.deepEqual(whole.gpu.targetSize, DISPLAY, 'no display colour to reconstruct into')
  assert.equal(whole.scale.drawn, 1)
})

test('lines keep their display width and textures their display density below the display', () => {
  const half = runtime(0.5).rt
  drawFrameAt(half, 0.5)
  assert.equal(renderPixelRatio(half), 1, 'two CSS pixels of the display are one of the render')
  assert.equal(renderMipBias(half), -1)
  const native = runtime(1, DISPLAY, false).rt
  assert.equal(renderPixelRatio(native), 2, "the host's ratio, to the bit")
  assert.equal(renderMipBias(native), 0)
})
