/**
 * What covers the ground of a block: a paved plinth with granite kerbs (downtown), a sidewalk
 * ring around lawns (suburbs, parks), the park's gravel paths and fountain plaza, and zebra
 * crossings laid on the road. Every plinth reaches 4 m under the ground, so a block on a gentle
 * slope shows a kerb, never a gap.
 */
import type { MeshPart, PropMesh, Surface } from '../../plan/contract.ts';
import { box, cylinder, lathe, prop, transform } from '../../props/index.ts';
import { CITY } from './surfaces.ts';
import { FOUNDATION } from './tower-kit.ts';

/** Height of a sidewalk above the road. */
export const KERB = 0.18;
/** Width of the sidewalk around every block. */
const SIDEWALK = 5;

/** A kerbed ring of sidewalk around a `size` square, its outer edge on the square. */
function ring(size: number, inner?: Surface): MeshPart[] {
  const h = FOUNDATION + KERB,
    parts: MeshPart[] = [];
  for (const s of [-1, 1]) {
    parts.push(
      transform(box(CITY.paving, [size, h, SIDEWALK]), {
        at: [0, -FOUNDATION, (s * (size - SIDEWALK)) / 2],
      }),
      transform(box(CITY.paving, [SIDEWALK, h, size - 2 * SIDEWALK]), {
        at: [(s * (size - SIDEWALK)) / 2, -FOUNDATION, 0],
      }),
      transform(box(CITY.kerb, [size + 0.1, 0.02, 0.3]), { at: [0, KERB, s * (size / 2 - 0.15)] }),
      transform(box(CITY.kerb, [0.3, 0.02, size + 0.1]), { at: [s * (size / 2 - 0.15), KERB, 0] }),
    );
  }
  if (inner)
    parts.push(
      transform(box(inner, [size - 2 * SIDEWALK, h - 0.03, size - 2 * SIDEWALK]), {
        at: [0, -FOUNDATION, 0],
      }),
    );
  return parts;
}

/** A fully paved block (downtown and mid-rise), `size` metres square. */
export const pavedBlock = (id: string, size: number): PropMesh => prop(id, ring(size, CITY.paving));

/** A sidewalk ring around the terrain's own ground (suburbs). */
export const sidewalkRing = (id: string, size: number): PropMesh => prop(id, ring(size));

/** A park block: sidewalks, lawn, a cross of gravel paths and a round plaza for the fountain. */
export function parkBlock(id: string, size: number): PropMesh {
  const inner = size - 2 * SIDEWALK,
    y = KERB - 0.03;
  return prop(id, [
    ...ring(size, CITY.lawn),
    transform(box(CITY.gravel, [inner, 0.04, 4]), { at: [0, y, 0] }),
    transform(box(CITY.gravel, [4, 0.04, inner]), { at: [0, y, 0] }),
    transform(cylinder(CITY.paving, 13, 0.06, { segments: 40 }), { at: [0, y, 0] }),
  ]);
}

/** A three-tier fountain: a moulded basin of water, a column with two bowls. */
export function fountain(): PropMesh {
  const bowl = (r: number, y: number) =>
    lathe(
      CITY.stone,
      [
        [0.4, y],
        [r * 0.6, y + 0.1],
        [r, y + 0.45],
        [r - 0.12, y + 0.5],
        [0.4, y + 0.32],
      ],
      {
        segments: 32,
      },
    );
  return prop('city/fountain', [
    lathe(
      CITY.stone,
      [
        [7.4, 0],
        [7.4, 0.55],
        [7.1, 0.75],
        [6.8, 0.75],
        [6.8, 0.2],
      ],
      { segments: 48, caps: false },
    ),
    transform(cylinder(CITY.water, 6.85, 0.5, { segments: 48 }), { at: [0, 0, 0] }),
    lathe(
      CITY.stone,
      [
        [0.9, 0],
        [0.6, 0.6],
        [0.45, 1.2],
        [0.45, 3.4],
        [0.3, 3.6],
        [0.3, 5],
      ],
      {
        segments: 20,
      },
    ),
    bowl(2.6, 2.1),
    bowl(1.4, 3.8),
    transform(cylinder(CITY.water, 2.35, 0.05, { segments: 32 }), { at: [0, 2.5, 0] }),
    transform(cylinder(CITY.water, 1.25, 0.05, { segments: 24 }), { at: [0, 4.2, 0] }),
  ]);
}

/** A zebra crossing spanning a `width` road along X, 3 m of stripes along Z. */
export function crossing(id: string, width: number): PropMesh {
  const stripes = Math.floor(width / 1.1);
  return prop(
    id,
    Array.from({ length: stripes }, (_, i) =>
      transform(box(CITY.zebra, [0.55, 0.02, 3]), { at: [(i - (stripes - 1) / 2) * 1.1, 0, 0] }),
    ),
  );
}
