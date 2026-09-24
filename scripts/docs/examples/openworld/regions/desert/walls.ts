/**
 * The pieces every mud-brick building of the desert is dressed with, in a wall's own frame (the
 * wall faces +Z): windows with timber frames and shutters, door-and-window facades, arched
 * gates of voussoirs, parapets with merlons, clay jars.
 */
import type { MeshPart } from '../../plan/contract.ts';
import {
  box,
  cylinder,
  hash01,
  lathe,
  roundedBox,
  SURFACES,
  transform,
} from '../../props/index.ts';
import { DESERT } from './palette.ts';

/** A window on a wall facing +Z at depth z: dark pane, timber frame, lintel, sill, shutter, bars. */
export function windowIn(x: number, y: number, w: number, h: number, z: number): MeshPart[] {
  const t = 0.08;
  return [
    transform(box(SURFACES.glass, [w, h, 0.02]), { at: [x, y, z] }),
    ...[-1, 1].map((s) =>
      transform(box(DESERT.palmWood, [t, h, 0.1]), { at: [x + (s * (w + t)) / 2, y, z + 0.05] }),
    ),
    transform(box(DESERT.palmWood, [w + 2 * t, t, 0.1]), { at: [x, y + h, z + 0.05] }),
    transform(box(DESERT.palmWood, [w + 0.5, 0.18, 0.25]), { at: [x, y + h + t, z + 0.12] }),
    transform(box(DESERT.mudPlaster, [w + 0.3, 0.1, 0.25]), { at: [x, y - 0.1, z + 0.12] }),
    transform(box(DESERT.palmWood, [w / 2, h, 0.04]), {
      at: [x - w * 0.75 - t, y, z + 0.2],
      yaw: 0.35,
    }),
    ...[-1, 1].map((s) =>
      transform(cylinder(SURFACES.darkMetal, 0.015, h, { segments: 4 }), {
        at: [x + (s * w) / 4, y, z + 0.06],
      }),
    ),
  ];
}

/** Openings along one +Z wall of `width` at depth `z`: windows per floor, a door on the ground. */
export function facade(
  width: number,
  floors: number,
  z: number,
  door: boolean,
  seed: number,
): MeshPart[] {
  const parts: MeshPart[] = [],
    bays = Math.max(1, Math.floor(width / 2.6));
  for (let f = 0; f < floors; f++)
    for (let b = 0; b < bays; b++) {
      const x = -width / 2 + (width * (b + 0.5)) / bays;
      if (f === 0 && door && b === Math.floor(bays / 2)) {
        parts.push(transform(box(DESERT.palmWood, [1.1, 2.1, 0.08]), { at: [x, 0, z + 0.04] }));
        parts.push(transform(box(DESERT.palmWood, [1.8, 0.25, 0.4]), { at: [x, 2.15, z + 0.2] }));
        parts.push(
          transform(box(DESERT.mudPlaster, [1.6, 0.12, 0.6]), { at: [x, -0.02, z + 0.2] }),
        );
      } else if (hash01(seed, f, b) > 0.2) parts.push(...windowIn(x, 0.9 + f * 3.2, 0.8, 1.1, z));
    }
  return parts;
}

/** A parapet round a `w × d` roof at height `h`: soft-cornered runs crowned by rounded merlons. */
export function parapet(w: number, d: number, h: number): MeshPart[] {
  const parts: MeshPart[] = [];
  for (const [len, at, yaw] of [
    [w, d / 2, 0],
    [w, -d / 2, 0],
    [d, w / 2, Math.PI / 2],
    [d, -w / 2, Math.PI / 2],
  ] as const) {
    const run = transform(roundedBox(DESERT.mudPlaster, [len, 0.7, 0.3], 0.1, 2), {
      at: [0, h, 0],
    });
    const merlons = Array.from({ length: Math.floor(len / 1.2) }, (_, i) =>
      transform(roundedBox(DESERT.mudPlaster, [0.45, 0.4, 0.32], 0.12, 1), {
        at: [-len / 2 + 0.6 + i * 1.2, h + 0.65, 0],
      }),
    );
    for (const part of [run, ...merlons])
      parts.push(transform(part, { yaw, at: yaw ? [at, 0, 0] : [0, 0, at] }));
  }
  return parts;
}

/** A clay water jar, 0.7 m. */
export const jar = () =>
  lathe(
    DESERT.rust,
    [
      [0.12, 0],
      [0.26, 0.15],
      [0.3, 0.35],
      [0.22, 0.58],
      [0.1, 0.64],
      [0.13, 0.7],
      [0.1, 0.7],
    ],
    { segments: 16 },
  );

/** An arched gate in a wall facing +Z at z: two piers, a round arch of voussoirs, timber doors if `doors`. */
export function archedGate(width: number, height: number, z: number, doors = true): MeshPart[] {
  const r = width / 2,
    springs = height - r,
    stones = Array.from({ length: 11 }, (_, i) => {
      const a = Math.PI * (i / 10);
      return transform(box(DESERT.mudBrick, [0.5, 0.35, 0.7]), {
        at: [-Math.cos(a) * (r + 0.2), springs + Math.sin(a) * (r + 0.2), z],
        roll: a - Math.PI / 2,
      });
    });
  return [
    ...[-1, 1].map((s) =>
      transform(box(DESERT.mudBrick, [0.6, springs, 0.8]), { at: [s * (r + 0.3), 0, z] }),
    ),
    ...stones,
    ...(doors
      ? [-1, 1].map((s) =>
          transform(box(DESERT.palmWood, [r, springs, 0.1]), { at: [(s * r) / 2, 0, z + 0.42] }),
        )
      : []),
  ];
}
