import { EffectPass } from './chain.ts'
import {
  MOTION_BLUR_LEAST,
  resolveMotionBlur,
  type MotionBlurOptions,
  type ResolvedMotionBlur,
} from '../../contracts/motionBlurOptions.ts'

export type { MotionBlurOptions, ResolvedMotionBlur } from '../../contracts/motionBlurOptions.ts'

/**
 * The blur a moving picture shows when the shutter of a camera stays open: each pixel gathers its
 * colour along its own motion since the last image, a streak whose length follows `amount`, the
 * frame rate it is relative to (`targetFps`) and the ceiling `max`
 * (`../../contracts/motionBlurOptions.ts` says each setting and its default; how the blur is
 * drawn — its quality above all — is the world's settings'). It runs on the image the temporal
 * pass resolved, or the lit one without it, before the exposure is measured and before every other
 * pass, and blurs only where something moves: a still image is left as it is.
 */
export class MotionBlur extends EffectPass {
  readonly kind = 'motionBlur'
  readonly stage = 'after-resolve'
  private held: ResolvedMotionBlur
  constructor(options: MotionBlurOptions = {}) {
    super()
    this.held = resolveMotionBlur(options)
  }
  private write(options: MotionBlurOptions) {
    this.held = resolveMotionBlur({ ...this.held, ...options })
    this.changed()
  }
  /** The strength of the blur, from 0 to 1; 0 is off. */
  get amount() {
    return this.held.amount
  }
  set amount(value: number) {
    this.write({ amount: value })
  }
  /** The longest streak, in percent of the image's width, from 0 to 100; 0 is off. */
  get max() {
    return this.held.max
  }
  set max(value: number) {
    this.write({ max: value })
  }
  /** The frame rate the streak is relative to, from 0 to 120; 0 follows the page's own rate. */
  get targetFps() {
    return this.held.targetFps
  }
  set targetFps(value: number) {
    this.write({ targetFps: value })
  }
  /** Whether the motion of the camera blurs the image. */
  get cameraMotion() {
    return this.held.cameraMotion
  }
  set cameraMotion(value: boolean) {
    this.write({ cameraMotion: value })
  }
  /** The smallest object, in percent of the screen, whose own motion is measured, for every pass
   *  that reads it; 0 leaves none out. */
  get perObjectSize() {
    return this.held.perObjectSize
  }
  set perObjectSize(value: number) {
    this.write({ perObjectSize: value })
  }
  /** Nothing to blur at an amount or a longest streak of the least: the engine passes it by. */
  override get idle() {
    const { amount, max } = this.held
    return !(amount > MOTION_BLUR_LEAST) || !(max > MOTION_BLUR_LEAST)
  }
}
