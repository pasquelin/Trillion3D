/**
 * Fuel canopies at real size, their road side facing +Z: pumps with screens and holstered
 * nozzles, a flat canopy on steel columns lit from beneath, the car forecourt on its concrete
 * slab and the truck stop's high canopy over diesel islands.
 */
import type { MeshPart, PropMesh, Vec3 } from '../../plan/contract.ts';
import { box, prop, SURFACES, transform, tube, type PropLamp } from '../../props/index.ts';
import { PLINTH } from './houses.ts';
import { DESERT } from './palette.ts';

const { concrete, steel, darkMetal, whitePaint, rubber } = SURFACES;

/** A pump 1.9 m high: cabinet, two screens, price glow, holstered nozzles on hoses. */
function pump(): MeshPart[] {
  const parts: MeshPart[] = [
    box(whitePaint, [1.1, 1.9, 0.5]),
    transform(box(DESERT.forecourtRed, [1.14, 0.35, 0.54]), { at: [0, 1.6, 0] }),
    transform(box(concrete, [1.3, 0.2, 0.7]), { at: [0, -0.05, 0] }),
  ];
  for (const side of [-1, 1]) {
    const z = side * 0.26;
    parts.push(transform(box(DESERT.signLight, [0.6, 0.25, 0.02]), { at: [0, 1.25, z] }));
    parts.push(transform(box(darkMetal, [0.3, 0.3, 0.03]), { at: [0.2, 0.8, z] }));
    for (const x of [-0.4, 0.4]) {
      parts.push(transform(box(darkMetal, [0.12, 0.3, 0.12]), { at: [x, 0.8, z + side * 0.08] }));
      parts.push(
        tube(
          rubber,
          [
            [x, 1.1, z],
            [x + 0.15, 0.4, z + side * 0.15],
            [x, 0.85, z + side * 0.1],
          ],
          0.02,
          { segments: 5 },
        ),
      );
    }
  }
  return parts;
}

/** A flat canopy `w × d` at clearance `h` on `columns` pairs of columns, lit panels underneath. */
function canopy(w: number, d: number, h: number, columns: number): MeshPart[] {
  const parts: MeshPart[] = [
    transform(box(whitePaint, [w, 1.2, d]), { at: [0, h, 0] }),
    transform(box(DESERT.forecourtRed, [w + 0.1, 0.5, d + 0.1]), { at: [0, h + 0.5, 0] }),
  ];
  for (let c = 0; c < columns; c++) {
    const x = -w / 2 + (w * (c + 0.5)) / columns;
    for (const z of [-d / 4, d / 4]) {
      parts.push(transform(box(steel, [0.5, h, 0.5]), { at: [x, 0, z] }));
      parts.push(transform(box(DESERT.canopyLight, [2.4, 0.05, 1.2]), { at: [x, h - 0.05, z] }));
    }
  }
  return parts;
}

/** Downlights under a canopy's panels: ~6 000 lm spots into a wide cone, night only. */
const canopyLamps = (w: number, d: number, h: number, columns: number): PropLamp[] =>
  Array.from({ length: columns }, (_, c) => -w / 2 + (w * (c + 0.5)) / columns).flatMap((x, c) =>
    [-d / 4, d / 4].map((z, k) => ({
      id: `canopy-${c}-${k}`,
      type: 'spot' as const,
      offset: [x, h - 0.1, z] as Vec3,
      direction: [0, -1, 0] as Vec3,
      cone: 1.1,
      color: [1, 0.97, 0.92] as const,
      intensity: 1800,
      range: 26,
      night: true,
    })),
  );

/** The car forecourt: a 34 × 24 m slab on its plinth, three islands of two pumps, a canopy. */
const FORECOURT = { w: 30, d: 16, h: 5.2, columns: 3 };
function forecourt(): PropMesh {
  const parts = [
    transform(box(concrete, [34, 0.3 + PLINTH, 24]), { at: [0, -PLINTH, 0] }),
    ...canopy(FORECOURT.w, FORECOURT.d, FORECOURT.h, FORECOURT.columns),
  ];
  for (let i = 0; i < 3; i++)
    for (const z of [-4, 4])
      parts.push(...pump().map((p) => transform(p, { at: [-10 + i * 10, 0.3, z] })));
  return prop('desert/forecourt', parts);
}
export const FORECOURT_LAMPS = canopyLamps(
  FORECOURT.w,
  FORECOURT.d,
  FORECOURT.h,
  FORECOURT.columns,
).map((l) => ({ ...l, offset: [l.offset[0], l.offset[1] + 0.3, l.offset[2]] as Vec3 }));

/** The truck canopy: 7 m clearance over two lanes, diesel pumps on long islands. */
const TRUCK_CANOPY = { w: 36, d: 20, h: 7, columns: 3 };
function truckCanopy(): PropMesh {
  const parts = canopy(TRUCK_CANOPY.w, TRUCK_CANOPY.d, TRUCK_CANOPY.h, TRUCK_CANOPY.columns);
  for (let i = 0; i < 3; i++) {
    parts.push(transform(box(concrete, [8, 0.25, 1.4]), { at: [-12 + i * 12, 0, 0] }));
    parts.push(...pump().map((p) => transform(p, { at: [-12 + i * 12, 0.25, 0] })));
  }
  return prop('desert/truck-canopy', parts);
}
export const TRUCK_CANOPY_LAMPS = canopyLamps(
  TRUCK_CANOPY.w,
  TRUCK_CANOPY.d,
  TRUCK_CANOPY.h,
  TRUCK_CANOPY.columns,
);

/** The two canopies. */
export const canopyProps = (): PropMesh[] => [forecourt(), truckCanopy()];
