import { clamp } from '../../../math/src/scalar/reals.ts'
import { deviceRefusal, retryFrame, type Refusal } from '../gpu/core/refusal.ts'
import { renderScaleBounds, type RenderScale } from './renderScaleOption.ts'
import type { ScaleControl } from './scaleControl.ts'

/**
 * What a drawn view reads of its render scale (`../webgpu/pages/state/renderScale.ts`,
 * `../taa/frame.ts`): its bounds, the scale it is drawn at, the scale its targets are made at, and
 * what it last drew. The main view's is the world's controller itself (`scaleControl.ts`); another
 * view's is `createViewScale`.
 */
export type ViewScale = Pick<
  ScaleControl,
  | 'bounds'
  | 'drawn'
  | 'steered'
  | 'wanted'
  | 'allocated'
  | 'capMemory'
  | 'memoryRefused'
  | 'liftMemoryCap'
  | 'drew'
  | 'fit'
>

/**
 * The render scale of a view drawn beside the main one (`world.addView`): a number fixes it;
 * `'auto'` or bounds follow the world's controller — the one budget the whole frame is fitted to,
 * every view's GPU time in it (`../webgpu/pages/prepare/timing.ts`) — within the view's bounds.
 * Its targets are made at its bounds' maximum and never capped: a size the budget refuses is asked
 * again after the device's wait (`../gpu/core/refusal.ts`), the frames drawing what they hold.
 */
export function createViewScale(option: RenderScale, world: Pick<ScaleControl, 'wanted'>) {
  let asked = option,
    pixels = 0,
    bounds = renderScaleBounds(option, 0),
    refusal: Refusal | undefined
  const scale = {
    get bounds() {
      return bounds
    },
    drawn: 1,
    steered: false,
    wanted: () => (bounds.auto ? clamp(world.wanted(), bounds.min, bounds.max) : bounds.max),
    allocated: () => bounds.max,
    capMemory: () => false,
    memoryRefused(_size: string, frame: number) {
      refusal = deviceRefusal(frame, refusal)
      return retryFrame(refusal)
    },
    liftMemoryCap: () => {},
    drew(drawn: number, steered: boolean) {
      scale.drawn = drawn
      scale.steered = steered
    },
    /** Another scale, from the next image. */
    set(next: RenderScale) {
      asked = next
      bounds = renderScaleBounds(next, pixels)
      refusal = undefined
    },
    /** The view's drawing-buffer size, which the bounds follow (`ScaleControl.fit`). */
    fit(width: number, height: number) {
      if (width * height === pixels) return
      pixels = width * height
      bounds = renderScaleBounds(asked, pixels)
    },
  }
  return scale satisfies ViewScale
}
