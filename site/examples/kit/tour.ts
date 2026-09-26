import { ease, mix, opening, type CirclingWorld, type Opening, type View } from './opening.ts';

/** A named part of a tour: the camera flies `seconds` to its view, then holds it `hold` seconds. */
export interface Pose extends View {
  name: string;
  seconds: number;
  hold: number;
}

/** A tour under way: an opening, and the part the camera is in. */
export interface Tour extends Opening {
  /** The pose flown to or held now; `null` once the tour has ended or the viewer took over. */
  readonly part: string | null;
}

/**
 * Flies the camera through `poses` in order, each eased by `curve` from where the last one left
 * it — the first from where the camera stands —, the same frames on every run: an opening, so the
 * viewer's first press or wheel on the canvas takes the controls, and the tour ends with its last
 * hold.
 */
export function tour(world: CirclingWorld, poses: readonly Pose[], curve = ease.inOut): Tour {
  const { position } = world.camera,
    { target } = world.controls;
  let start: number[] = [],
    part: string | null = null;
  const glide = opening(world, (time) => {
    if (time === 0) start = [position.x, position.y, position.z, target.x, target.y, target.z];
    let from = start,
      at = time;
    for (const pose of poses) {
      const to = [...pose.position, ...pose.target];
      if (at < pose.seconds + pose.hold) {
        const [x, y, z, tx, ty, tz] = mix(from, to, curve(at / pose.seconds));
        position.set(x, y, z);
        target.set(tx, ty, tz);
        part = pose.name;
        return true;
      }
      [from, at] = [to, at - pose.seconds - pose.hold];
    }
    part = null;
    return false;
  });
  return Object.defineProperties(glide, {
    part: { get: () => (glide.gliding ? part : null) },
  }) as Tour;
}
