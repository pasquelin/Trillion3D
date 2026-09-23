import { RUN_CADENCE, type CharacterSettings } from './characterSettings.ts';

/**
 * WHERE THE EYE RIDES ON A CHARACTER'S BODY: a height to add to `eyeHeight`, drawn after the
 * body's step, so the camera moves as a head does while the body moves as a capsule does.
 *
 * BOB. The head rises and falls once a step, lowest as a foot takes the weight. The stride's
 * phase turns at the running cadence while the feet are on a floor, in proportion to the speed
 * up to a jog, and holds still in the air; the eye travels `headBob` above and below its
 * height, as much of that as the speed is of a jog. The bob follows the velocity, so it fades
 * as the body stops and is gone at rest.
 *
 * DIP. A landing hands the eye the downward speed of the impact; the knees then stop it as a
 * critically damped spring whose lowest point comes `landingDip` seconds after touch-down, at
 * `impact × landingDip / e` below the eye's height, and bring it back without overshoot. The
 * spring is solved in closed form, the same at any frame rate.
 *
 * A setting at 0 turns its motion off. A body at rest with a settled dip adds exactly 0, so a
 * still character stays still.
 */
export function createCharacterEye(
  settings: Pick<CharacterSettings, 'walkSpeed' | 'headBob' | 'landingDip'>,
) {
  let stride = 0,
    dip = 0,
    sinking = 0;
  return {
    /** The stride's phase in radians, in [0, 2π): one foot strikes the floor at 0, the other
     *  at π. */
    get stride() {
      return stride;
    },
    /** The feet met a floor at `impact` metres per second, downward. */
    land(impact: number) {
      if (settings.landingDip > 0) sinking -= Math.max(0, impact);
    },
    /** Lives `delta` seconds of a body moving at `velocity`; returns the height to add. */
    offset(delta: number, velocity: ArrayLike<number>, grounded: boolean) {
      const pace =
        settings.walkSpeed > 0
          ? Math.min(1, Math.hypot(velocity[0], velocity[2]) / settings.walkSpeed)
          : 0;
      if (grounded) stride = (stride + Math.PI * RUN_CADENCE * pace * delta) % (2 * Math.PI);
      if (settings.landingDip <= 0) dip = sinking = 0;
      else if (dip !== 0 || sinking !== 0) {
        const rate = 1 / settings.landingDip,
          k = (sinking + rate * dip) * delta,
          decay = Math.exp(-rate * delta);
        [dip, sinking] = [(dip + k) * decay, (sinking - rate * k) * decay];
        // Under a hundredth of a millimetre, and slower than that per second: settled.
        if (Math.abs(dip) < 1e-5 && Math.abs(sinking) < 1e-5) dip = sinking = 0;
      }
      return -settings.headBob * pace * Math.cos(2 * stride) + dip;
    },
  };
}
