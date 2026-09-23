/**
 * The finish of a suburban house and its garden: the details of a pitched roof, front steps,
 * and the picket fence run that closes the lots.
 */
import type { MeshPart, PropMesh, Surface } from '../../plan/contract.ts';
import { box, prop, SURFACES, transform, tube } from '../../props/index.ts';
import { CITY } from './surfaces.ts';

/**
 * What makes a pitched roof read as built: tile courses up both slopes, a ridge cap, fascia
 * boards on the eaves, gutters, and downpipes at the four corners.
 */
export function roofDetail(
  s: Surface,
  w: number,
  d: number,
  rise: number,
  top: number,
): MeshPart[] {
  const o = 0.5,
    run = d / 2 + o,
    pitch = Math.atan2(rise, run),
    slope = Math.hypot(rise, run),
    parts: MeshPart[] = [];
  for (const side of [-1, 1]) {
    for (let k = 1; k < 8; k++) {
      const t = k / 8;
      parts.push(
        transform(box(s, [w + 2 * o, 0.05, slope / 9]), {
          at: [0, top + rise * (1 - t) + 0.03, side * run * t],
          pitch: side * pitch,
        }),
      );
    }
    parts.push(
      transform(box(CITY.frame, [w + 2 * o, 0.25, 0.04]), {
        at: [0, top - 0.25, side * (run + 0.02)],
      }),
      tube(
        CITY.railing,
        [
          [-w / 2 - o, top - 0.2, side * (run + 0.12)],
          [w / 2 + o, top - 0.2, side * (run + 0.12)],
        ],
        0.07,
        { segments: 6 },
      ),
      ...[-1, 1].map((sx) =>
        tube(
          CITY.railing,
          [
            [sx * (w / 2 + 0.1), top - 0.2, side * (run + 0.12)],
            [sx * (w / 2 + 0.1), top - 0.4, side * (d / 2 + 0.1)],
            [sx * (w / 2 + 0.1), 0.1, side * (d / 2 + 0.1)],
          ],
          0.04,
          { segments: 5 },
        ),
      ),
    );
  }
  parts.push(transform(box(s, [w + 2 * o - 0.2, 0.18, 0.35]), { at: [0, top + rise - 0.05, 0] }));
  return parts;
}

/** Three steps up to the front door. */
export const steps = (d: number): MeshPart[] =>
  [0, 1, 2].map((k) =>
    transform(box(CITY.renderGrey, [1.8, 0.17 * (3 - k), 0.35]), {
      at: [0, 0, d / 2 + 0.2 + (2 - k) * 0.35],
    }),
  );

/** A 22.5 m white picket fence along X: posts every 2.5 m, two rails, pickets every 0.3 m. */
export function gardenFence(): PropMesh {
  const length = 22.5,
    parts: MeshPart[] = [];
  for (let x = -length / 2; x <= length / 2 + 1e-6; x += 2.5)
    parts.push(transform(box(SURFACES.whitePaint, [0.1, 1.1, 0.1]), { at: [x, 0, 0] }));
  for (const y of [0.3, 0.8])
    parts.push(transform(box(SURFACES.whitePaint, [length, 0.08, 0.04]), { at: [0, y, 0.07] }));
  for (let x = -length / 2 + 0.15; x < length / 2; x += 0.3)
    parts.push(transform(box(SURFACES.whitePaint, [0.08, 0.95, 0.02]), { at: [x, 0.05, 0.1] }));
  return prop('city/garden-fence', parts);
}
