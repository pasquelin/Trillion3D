/**
 * A coconut palm of a given height: a leaning ringed trunk, a crown of arching fronds, each a
 * rib carrying two rows of drooping leaflets, and a cluster of nuts under the crown.
 */
import type { MeshPart, Vec3 } from '../plan/contract.ts';
import { blade, type Sheet } from './branches.ts';
import { meshPart } from './geometry.ts';
import { hash01 } from './noise.ts';
import { sphere, tube } from './round.ts';
import { SURFACES } from './surfaces.ts';
import { transform } from './transform.ts';
import { add, cross, unit } from './vector.ts';

/** How finely a palm is drawn: the kit's own, or the light one a grove packs by the dozen. */
const GRADES = {
  large: { stations: 120, segments: 32, fronds: 24, leaflets: 90, rib: 14, ribSides: 5, nuts: 7 },
  small: { stations: 60, segments: 16, fronds: 16, leaflets: 60, rib: 14, ribSides: 5, nuts: 7 },
  stand: { stations: 12, segments: 6, fronds: 10, leaflets: 24, rib: 6, ribSides: 3, nuts: 0 },
};

export function palm(height: number, seed: number, grade?: 'stand'): MeshPart[] {
  const g = GRADES[grade ?? (height > 10 ? 'large' : 'small')],
    stations = g.stations,
    lean = height * 0.12,
    spine = Array.from({ length: stations + 1 }, (_, i): Vec3 => {
      const t = i / stations;
      return [lean * t * t, height * t, lean * 0.2 * Math.sin(t * 3)];
    }),
    // Leaf-scar rings: the radius swells every half metre.
    radii = spine.map(
      ([, y]) => height * (0.026 - 0.008 * (y / height)) * (1 + 0.06 * Math.cos(y * 4 * Math.PI)),
    ),
    parts = [tube(SURFACES.palmBark, spine, radii, { segments: g.segments, caps: true })];
  const top = spine[stations],
    { fronds, leaflets, rib: ribPoints } = g,
    length = height * 0.42,
    sheet: Sheet = { positions: [], indices: [] };
  for (let f = 0; f < fronds; f++) {
    const angle = f * 2.39996 + hash01(seed, f) * 0.3,
      rise = 0.5 - 0.9 * hash01(seed, f, 1),
      out: Vec3 = [Math.cos(angle), 0, Math.sin(angle)],
      rib = Array.from({ length: ribPoints }, (_, s): Vec3 => {
        const t = s / (ribPoints - 1);
        return add(add(top, out, length * t), [0, 1, 0], length * (rise * t - 0.7 * t * t));
      });
    parts.push(
      tube(
        SURFACES.palmBark,
        rib,
        rib.map((_, s) => 0.05 * (1 - s / ribPoints) + 0.01),
        { segments: g.ribSides },
      ),
    );
    for (let l = 0; l < leaflets; l++) {
      const t = 0.1 + 0.88 * (Math.floor(l / 2) / (leaflets / 2)),
        s = Math.min(ribPoints - 2, Math.floor(t * (ribPoints - 1))),
        along = unit(add(rib[s + 1], rib[s], -1)),
        side = unit(cross(along, [0, 1, 0])),
        droop = add(add(side, along, 0.45), [0, -1, 0], 0.55 + 0.3 * hash01(seed, f, l)),
        dir = unit(l % 2 ? droop : add(droop, side, -2)),
        span = length * 0.32 * Math.sin(Math.PI * Math.min(0.98, t + 0.08));
      blade(sheet, rib[s], dir, unit(cross(dir, along)), span, span * 0.12);
    }
  }
  parts.push(meshPart(SURFACES.palmLeaves, sheet.positions, sheet.indices));
  for (let n = 0; n < g.nuts; n++) {
    const a = n * 0.9 + seed;
    parts.push(
      transform(sphere(SURFACES.palmBark, height * 0.012, { segments: 10, rings: 6 }), {
        at: add(top, [Math.cos(a) * height * 0.03, -height * 0.02, Math.sin(a) * height * 0.03]),
      }),
    );
  }
  return parts;
}
