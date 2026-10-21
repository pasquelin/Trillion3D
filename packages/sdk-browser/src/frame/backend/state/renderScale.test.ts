import test from 'node:test'
import assert from 'node:assert/strict'
import {
  drawFrameAt,
  frameSizeOf,
  renderMipBias,
  renderPixelRatio,
  type FrameSize,
} from './renderScale.ts'
import {
  displayResolutionFraction,
  renderExtent,
  type RenderScale,
} from '../../scale/renderScaleOption.ts'
// The controller's instant drop sets the scale drawn; the rules tested hold under either.
import { createScaleControl } from '../../scale/scaleControl.ts'
import { lowered } from '../../scale/scaleFit.fixture.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

const DISPLAY = [3456, 2234]
/** The controller's bounds of the display's own size down to half of it. */
const FULL_RANGE = { min: 0.5, max: 1 }
/** The default render fraction on `DISPLAY` (`displayResolutionFraction`): ~0.51. */
const DEFAULT = displayResolutionFraction(DISPLAY[0] * DISPLAY[1])

/** A view that accumulates in the beauty view, the page asking `scale`, its targets made at
 *  `allocated` for the host's display; `extents` hears what the Hi-Z pyramid is built over. */
function runtime(scale: RenderScale | undefined, allocated = DISPLAY, apart = true) {
  const extents: number[][] = [],
    colorTexture = {},
    control = createScaleControl(scale)
  const rt = {
    setup: { viewport: DISPLAY, pixelRatio: () => 2 },
    context: {},
    views: { active: { scale: control } },
    gpu: {
      temporal: {},
      temporalLevel: 'max',
      targetSize: [...allocated],
      allocatedSize: [...allocated],
      displaySize: DISPLAY,
      colorTexture,
      displayTexture: apart ? {} : colorTexture,
    },
    run: { diagnostic: 'beauty' },
    capture: { capturing: false },
    vis: { gpuHiz: { extent: (w: number, h: number) => extents.push([w, h]) } },
  } as unknown as WebgpuPagesRuntime
  return { rt, extents, control }
}

const sizeOf = (rt: WebgpuPagesRuntime) => ({ ...frameSizeOf(rt, {} as FrameSize) })

test('a render axis is the display at native size, else a multiple of eight', () => {
  assert.equal(renderExtent(1117, 1), 1117, 'native size keeps an odd axis as it is')
  assert.equal(renderExtent(3456, 0.5), 1728)
  assert.equal(renderExtent(2234, 0.5), 1120)
  assert.equal(renderExtent(3456, 0.67), 2312)
  assert.equal(renderExtent(12, 0.5), 8, 'never below eight')
})

// The targets start at the bounds' maximum, the display colour apart; absent or `'auto'`, the
// maximum is the display's default.
test('the targets start at the maximum, apart from the display wherever a scale may drop', () => {
  const native = { width: 3456, height: 2234, renderWidth: 3456, renderHeight: 2234 }
  const atDefault = {
    ...native,
    renderWidth: renderExtent(3456, DEFAULT),
    renderHeight: renderExtent(2234, DEFAULT),
    apart: true,
  }
  assert.deepEqual(sizeOf(runtime('auto').rt), atDefault)
  assert.deepEqual(sizeOf(runtime(undefined).rt), atDefault)
  assert.deepEqual(sizeOf(runtime(FULL_RANGE).rt), { ...native, apart: true })
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
})

// A capture and a GPU variant stay at the display's size; a diagnostic view keeps the view's
// targets, drawn in them at the pixel centre: switching to it remakes none.
test('a capture and a GPU variant draw at the display size, a diagnostic view in the targets kept', () => {
  const changes: [string, (view: WebgpuPagesRuntime) => void][] = [
    ['a capture', (view) => (view.capture.capturing = true)],
    ['a GPU variant', (view) => (view.context.diagnosticGpuVariant = 'geometry-flat')],
  ]
  for (const [what, change] of changes) {
    const { rt } = runtime(0.5)
    change(rt)
    const size = sizeOf(rt)
    assert.deepEqual([size.renderWidth, size.apart], [3456, false], what)
  }
  const { rt } = runtime(0.5)
  const beauty = sizeOf(rt)
  rt.run.diagnostic = 'normals' as never
  assert.deepEqual(sizeOf(rt), beauty, 'a diagnostic view: the targets of the beauty view')
  assert.deepEqual([beauty.renderWidth, beauty.apart], [1728, true])
})

// A scale the page asked was ignored without temporal antialiasing: a feed at 0.5 with the pass off
// drew at the display's size. As the dynamic resolution does without an upscaler, the targets are
// made at the bounds' maximum and the composition upscales the scale drawn in them.
test('without the temporal resolve, the targets are made at the bounds maximum, apart', () => {
  for (const off of [
    (view: WebgpuPagesRuntime) => (view.gpu.temporalLevel = 'off'),
    (view: WebgpuPagesRuntime) => (view.gpu.temporal = undefined),
  ]) {
    const fixed = runtime(0.5).rt
    off(fixed)
    assert.deepEqual([sizeOf(fixed).renderWidth, sizeOf(fixed).apart], [1728, true])
    const bounded = runtime({ min: 0.5, max: 0.8 }).rt
    off(bounded)
    assert.deepEqual([sizeOf(bounded).renderWidth, sizeOf(bounded).apart], [2768, true])
    const auto = runtime('auto').rt
    off(auto)
    assert.deepEqual(
      [sizeOf(auto).renderWidth, sizeOf(auto).apart],
      [renderExtent(3456, DEFAULT), true],
    )
  }
})

// Decision 14: switched off or on under the full range, the targets are made at the bounds'
// maximum, the display's own: neither the switch nor any move of the controller changes their size.
test('switched back on, the targets made off stay, whatever the controller asks', () => {
  const { rt, control } = runtime(FULL_RANGE)
  rt.gpu.temporalLevel = 'off'
  assert.equal(sizeOf(rt).renderWidth, 3456)
  rt.gpu.temporalLevel = 'max'
  assert.equal(sizeOf(rt).renderWidth, 3456, 'on again: the same targets')
  lowered(control, 40)
  assert.equal(control.wanted(), 0.5)
  assert.equal(sizeOf(rt).renderWidth, 3456, 'the controller moved: nothing remade')
})

// The scale asked was read back, not the size drawn — a full-scale image drawn in targets made
// at a maximum of 0.8, or one the targets held below the controller, was told as the scale asked,
// and measured as the controller's.
test('the scale read back is the size drawn; one the targets hold smaller is not measured', () => {
  const { rt, control } = runtime({ min: 0.5, max: 0.8 }, [2768, 1784])
  drawFrameAt(rt, 1, true)
  assert.deepEqual(rt.gpu.targetSize, [2768, 1784])
  assert.deepEqual([control.drawn, control.steered], [2768 / 3456, false])
  drawFrameAt(rt, 0.6, true)
  assert.deepEqual([control.drawn, control.steered], [0.6, true], 'held whole: the scale asked')
  // Targets refused: made an eighth lower, the controller's scale held there with them.
  for (let frame = 0; frame < 4; frame++) control.tick((frame * 1000) / 120)
  assert.equal(control.wanted(), 0.8)
  assert.equal(control.capMemory('3456x2234'), true)
  assert.equal(control.wanted(), 0.675, 'the controller asks no more than the targets hold')
  rt.gpu.allocatedSize = [renderExtent(3456, 0.675), renderExtent(2234, 0.675)]
  drawFrameAt(rt, control.wanted(), true)
  assert.deepEqual([control.drawn, control.steered], [0.675, true], 'drawn whole, measured')
  for (let frame = 4; frame < 16; frame++) control.tick((frame * 1000) / 120)
  control.observe(4, 0.675)
  assert.equal(control.wanted(), 0.675, 'cheap frames rise no higher than the targets')
  control.uncapMemory()
  assert.equal(control.allocated('3456x2234'), 0.8, 'the room came back')
})

test('an image draws at the scale asked, the controller starting at its maximum', () => {
  assert.equal(runtime('auto').control.wanted(), 1)
  assert.equal(runtime(0.6).control.wanted(), 0.6)
  assert.equal(runtime({ min: 0.5, max: 0.8 }).control.wanted(), 0.8)
})

// Targets made on a ladder of eighths were remade at each rung the controller crossed, the
// frame held for the memory and the history restarted: a flicker as the camera starts or stops.
test('the targets are made at the bounds maximum whatever the controller draws in them', () => {
  const { rt, control } = runtime(FULL_RANGE)
  const full = { width: 3456, height: 2234, renderWidth: 3456, renderHeight: 2234, apart: true },
    clock = lowered(control, 12)
  assert.ok(control.wanted() < 0.875, `a 12 ms frame at 120 Hz draws at ${control.wanted()}`)
  assert.deepEqual(sizeOf(rt), full)
  lowered(control, 40, clock)
  assert.equal(control.wanted(), 0.5, 'a 40 ms frame drops to the minimum')
  assert.deepEqual(sizeOf(rt), full, 'nothing to remake')
  const bounded = runtime({ min: 0.5, max: 0.8 }).rt
  assert.deepEqual(sizeOf(bounded), { ...full, renderWidth: 2768, renderHeight: 1784 })
})

test('a scale change within the targets draws in them in place, the Hi-Z pyramid over the same size', () => {
  const { rt, extents, control } = runtime('auto')
  drawFrameAt(rt, 0.5)
  assert.deepEqual(rt.gpu.targetSize, [1728, 1120])
  assert.deepEqual(rt.gpu.allocatedSize, DISPLAY, 'nothing remade')
  assert.equal(control.drawn, 0.5, 'the read-back is the scale drawn')
  drawFrameAt(rt, 1)
  assert.deepEqual(rt.gpu.targetSize, DISPLAY)
  assert.equal(control.drawn, 1)
  assert.deepEqual(extents, [[1728, 1120], DISPLAY])
})

test('a fixed scale is honoured, and targets without a display apart draw whole', () => {
  const fixed = runtime(0.6, [2072, 1344]).rt
  drawFrameAt(fixed, fixed.views.active.scale.wanted())
  assert.deepEqual(fixed.gpu.targetSize, [2072, 1344])
  assert.equal(fixed.views.active.scale.drawn, 0.6)
  const whole = runtime('auto', DISPLAY, false).rt
  drawFrameAt(whole, 0.5)
  assert.deepEqual(whole.gpu.targetSize, DISPLAY, 'no display colour to reconstruct into')
  assert.equal(whole.views.active.scale.drawn, 1)
})

test('lines keep their display width and textures their display density below the display', () => {
  const half = runtime(0.5).rt
  drawFrameAt(half, 0.5)
  assert.equal(renderPixelRatio(half), 1, 'two CSS pixels of the display are one of the render')
  // The automatic view mip bias: −1 − 0.3, quantised up to 8/1024.
  assert.equal(renderMipBias(half), -1.296875)
  const native = runtime(1, DISPLAY, false).rt
  assert.equal(renderPixelRatio(native), 2, "the host's ratio, to the bit")
  // The temporal resolve at native size keeps the −0.3 offset alone, quantised.
  assert.equal(renderMipBias(native), -0.296875)
})
