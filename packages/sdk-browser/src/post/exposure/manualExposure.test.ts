// The manual exposure is the camera's: its EV100, the bias and the curve it reads at that EV100;
// the CPU's one source of the exposure reads it, or the meter's readback, or a fixed number.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EXPOSURE_RULES,
  type ExposureValues,
} from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import { exposureCurveTable } from '../../../../sdk-core/src/contracts/exposureCurveTable.ts'
import { fixedExposure, manualExposure } from '../../../../sdk-core/src/contracts/exposureManual.ts'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { beginPreExposure, preExposureOf } from './pre.ts'
import { NO_CURVE, settingsOf, within } from './meter.fixture.ts'

test('the manual exposure is the camera’s: its EV100, the bias and the curve it reads at that EV100', () => {
  const settings = settingsOf()
  // f/4, 1/60 s, ISO 100: EV100 = log2(16 · 60), the white point 960: two to the bias over it.
  within(manualExposure(settings, NO_CURVE, 4).exposure, 2 / 960, 1e-9, 'the camera’s defaults')
  within(manualExposure(settings, NO_CURVE, 8).exposure, 2 / 3840, 1e-9, 'a stop at f/8 is two')
  within(
    manualExposure(settingsOf({ exposureCameraIso: 400 }), NO_CURVE, 4).exposure,
    2 / 240,
    1e-9,
  )
  // The old multiplier n, as a bias with the camera off: the same exposure for each number.
  for (const n of [0.0625, 0.5, 1, 3.5, 250]) {
    const asBias = settingsOf({ exposureApplyPhysicalCamera: false, exposureBias: Math.log2(n) })
    within(manualExposure(asBias, NO_CURVE, 4).exposure, n, 1e-12, `${n}`)
  }
  // The lens' saturation luminance divides it: a lens attenuation of 0.39 halves the exposure.
  const half = settingsOf({ exposureApplyPhysicalCamera: false, exposureLensAttenuation: 0.39 })
  within(manualExposure(half, NO_CURVE, 4).exposure, 2 / 2, 1e-12, 'a saturation of 2')
  // The curve is read at the camera's EV100 over middle grey: a step up of one stop at 12 reads
  // it at f/4 (EV100 9.9, read at 12.4) and not at ISO 400 (7.9, read at 10.4); the table's samples
  // are 0.48 stops apart, so the step is a ramp between two of them.
  const step = exposureCurveTable([{ ev: 0, compensation: 0, interpolation: 'constant' }, [12, 1]])
  within(manualExposure(settings, step, 4).exposure, (2 * 2) / 960, 1e-3, 'read past the step')
  within(manualExposure(settingsOf({ exposureCameraIso: 400 }), step, 4).exposure, 2 / 240, 1e-9)
  within(manualExposure(settings, step, 4).compensation, 2 * 2, 1e-3, 'the bias and the curve')
  // The middle grey the local exposure pulls toward: the bias cancels out of a manual exposure's,
  // the curve's factor stays, and a fixed exposure's has neither.
  const biased = settingsOf({ exposureBias: 3, localExposureMiddleGreyBias: 1 })
  within(manualExposure(biased, NO_CURVE, 4).grey, Math.log2(0.18 * 2), 1e-12, 'bias cancelled')
  within(manualExposure(settings, step, 4).grey, Math.log2(0.18 * 2), 1e-3, 'the curve’s factor')
  const fixed = fixedExposure(0.25, biased)
  assert.deepEqual(
    [fixed.exposure, fixed.compensation, fixed.mean],
    [0.25, 1, 4],
    'the number itself, bias and curve ignored',
  )
  within(fixed.grey, Math.log2(0.18 * 2), 1e-12, 'the local bias alone')
})

/** A lit view as the CPU's readers see it: the scene's `exposure`, the settings over the defaults,
 *  the depth of field's aperture in the chain where one is given, the meter's last readback. */
function viewOf(exposure: unknown, options: Partial<ExposureValues> = {}, aperture?: number) {
  return {
    lights: { store: { environment: { exposure }, unlit: false } },
    gpu: { exposure: { last: 0.25, local: 3 } },
    context: {
      ...resolveSettings(EXPOSURE_RULES, {}),
      ...options,
      effects: aperture ? { passes: [{ kind: 'depthOfField', values: { aperture } }] } : undefined,
      exposureCurve: undefined,
    },
    run: { diagnostic: 'beauty' },
    views: { active: { overrides: { post: true } } },
  } as unknown as WebgpuPagesRuntime
}

/** The exposure the CPU knows for the next image of `rt`: read once, by the pre-exposure. */
const exposureOf = (rt: WebgpuPagesRuntime) => beginPreExposure(rt).exposure

test('the CPU’s one exposure: a number is itself, the manual method the camera’s, the automatic one the meter’s', () => {
  assert.equal(exposureOf(viewOf(3.5)), 3.5, 'a fixed exposure, whatever the method')
  assert.equal(exposureOf(viewOf(3.5, { exposureMethod: 'manual' })), 3.5)
  assert.equal(exposureOf(viewOf('auto')), 0.25, 'the meter’s readback')
  assert.equal(exposureOf(viewOf('auto', { exposureMethod: 'basic' })), 0.25)
  within(exposureOf(viewOf('auto', { exposureMethod: 'manual' })), 2 / 960, 1e-9, 'manual')
  // The lens' f-stop is the depth of field's, drawing or not.
  within(exposureOf(viewOf('auto', { exposureMethod: 'manual' }, 8)), 2 / 3840, 1e-9, 'f/8')
})

test('the local exposure’s mean gain is the meter’s alone: a fixed or a manual exposure measures none, whatever was measured before', () => {
  // The pre-exposure is the exposure times the tint (1) times the gain the meter read back.
  const now = (exposure: unknown, options: Partial<ExposureValues> = {}) => {
    const pre = beginPreExposure(viewOf(exposure, options))
    return pre.now / pre.exposure
  }
  within(now('auto'), 3, 1e-6, 'the histogram’s')
  within(now('auto', { exposureMethod: 'basic' }), 3, 1e-6, 'the basic method’s')
  within(now('auto', { exposureMethod: 'manual' }), 1, 1e-6, 'the manual method, after another')
  within(now(2), 1, 1e-6, 'a fixed exposure')
})

test('the pre-exposure holds the exposure the CPU knows, read once for the image: every reader takes it from there', () => {
  const rt = viewOf('auto', { exposureMethod: 'manual' })
  const pre = beginPreExposure(rt)
  within(pre.exposure, 2 / 960, 1e-9, 'the one exposure')
  within(pre.now, pre.exposure, 1e-9, 'written multiplied by it')
  within(pre.shown, 1, 1e-9, 'and shown at the exposure over it')
  assert.equal(preExposureOf(rt).exposure, pre.exposure)
  assert.equal(pre.held?.exposure, pre.exposure, 'the held exposure the meter writes')
  const before = pre.now // the state is one object, rewritten by the next image
  // The next image reads it again: the camera changed, the number with it.
  Object.assign(rt.context, { exposureCameraIso: 400 })
  const next = beginPreExposure(rt)
  within(next.exposure, 2 / 240, 1e-9, 'the next image')
  within(next.previous, before, 1e-9, 'the image before')
  within(next.shown, 1, 1e-9)
  // A measuring method holds none: the readback is the exposure.
  Object.assign(rt.context, { exposureMethod: 'histogram' })
  assert.equal(beginPreExposure(rt).held, undefined)
})
