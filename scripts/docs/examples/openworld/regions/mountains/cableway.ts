/**
 * The cable car's props: a station (valley and summit share it: concrete base, glass hall, the
 * bullwheel turning the two lines out of its +Z front), tubular pylons in three heights with
 * their sheave trains and ladders, and the cabin hanging from its grip. Two lines run `GAUGE`
 * apart; the cable passes `CABLE_HEIGHT` above a station's floor and `SHEAVE` above a pylon top.
 */
import type { MeshPart, PropMesh, Vec3 } from '../../plan/contract.ts';
import {
  cylinder,
  extrude,
  prop,
  SURFACES,
  transform,
  tube,
  type Point2,
  type PropLamp,
} from '../../props/index.ts';
import { BASEMENT } from './chalet.ts';
import { boxAt } from './parts.ts';
import { MOUNTAIN_SURFACES as S } from './surfaces.ts';

export const GAUGE = 6;
export const CABLE_HEIGHT = 9;
export const SHEAVE = 1.1;
export const PYLON_HEIGHTS = [16, 26, 38] as const;
const ACROSS = Math.PI / 2;

/** A horizontal wheel of radius `r` at height `y`: rim, spokes, hub. */
function bullwheel(r: number, y: number, z: number): MeshPart[] {
  const rim = Array.from({ length: 49 }, (_, i): Vec3 => {
      const a = (i / 48) * Math.PI * 2;
      return [Math.cos(a) * r, y, z + Math.sin(a) * r];
    }),
    parts = [tube(SURFACES.darkMetal, rim, 0.18, { segments: 8 })];
  for (let k = 0; k < 8; k++)
    parts.push(
      boxAt(SURFACES.steel, [r * 2, 0.15, 0.15], { at: [0, y - 0.07, z], yaw: (k / 8) * Math.PI }),
    );
  parts.push(
    transform(cylinder(SURFACES.darkMetal, 0.5, 1.6, { segments: 16 }), { at: [0, y - 1.2, z] }),
  );
  return parts;
}

export function station(): PropMesh {
  const [w, d] = [18, 14],
    parts: MeshPart[] = [
      boxAt(S.stoneWall, [w + 0.4, BASEMENT + 0.4, d + 0.4], { at: [0, -BASEMENT, 0] }),
      boxAt(S.concrete, [w, 4, d], { at: [0, 0.4, 0] }),
      boxAt(SURFACES.glass, [w - 0.4, 6, d - 0.4], { at: [0, 4.4, -0.2] }),
      boxAt(S.concrete, [w + 1.6, 0.5, d + 2.4], { at: [0, 10.4, 0.6], pitch: -0.04 }),
      boxAt(S.concrete, [4, 0.3, 3], { at: [-w / 2 + 2, 0.1, d / 2 + 1.5] }),
      boxAt(S.cabinRed, [6, 1.2, 0.2], { at: [0, 11.2, d / 2 + 1.6] }),
      ...bullwheel(GAUGE / 2, CABLE_HEIGHT, d / 2 - 1),
    ];
  for (let x = -w / 2 + 0.2; x <= w / 2; x += 1.5)
    for (const z of [-d / 2 + 0.05, d / 2 - 0.45])
      parts.push(boxAt(SURFACES.steel, [0.12, 6, 0.12], { at: [x, 4.4, z] }));
  for (let z = -d / 2 + 1.5; z < d / 2; z += 1.5)
    for (const x of [-w / 2 + 0.25, w / 2 - 0.25])
      parts.push(boxAt(SURFACES.steel, [0.12, 6, 0.12], { at: [x, 4.4, z] }));
  for (let step = 0; step < 8; step++)
    parts.push(
      boxAt(S.concrete, [2.4, 0.2, 0.35], {
        at: [w / 2 - 2, 0.4 - step * 0.2, d / 2 + 0.2 + step * 0.35],
      }),
    );
  return prop('mountains/cable-station', parts);
}

export const STATION_LAMPS: readonly PropLamp[] = [-5, 5].map((x) => ({
  id: `entrance-${x < 0 ? 'west' : 'east'}`,
  type: 'point' as const,
  offset: [x, 3.6, 7.6] as Vec3,
  color: [1, 0.85, 0.7] as const,
  intensity: 300,
  range: 18,
  night: true,
}));

/** A pylon `h` metres to its crossarm. */
export function pylon(h: number): PropMesh {
  const parts: MeshPart[] = [
    boxAt(S.concrete, [3, 1.6, 3], { at: [0, -1, 0] }),
    transform(cylinder(S.cabinRed, 0.85, h, { top: 0.5, segments: 16 }), { at: [0, 0.5, 0] }),
    boxAt(SURFACES.steel, [GAUGE + 1.6, 0.8, 1.0], { at: [0, h, 0] }),
    boxAt(SURFACES.steel, [GAUGE + 1.6, 0.05, 1.8], { at: [0, h + 0.8, 0] }),
  ];
  for (const x of [-GAUGE / 2, GAUGE / 2]) {
    parts.push(boxAt(SURFACES.darkMetal, [0.35, 0.4, 5.4], { at: [x, h + 0.8, 0] }));
    for (let k = 0; k < 6; k++)
      parts.push(
        transform(cylinder(SURFACES.darkMetal, 0.3, 0.14, { segments: 14 }), {
          at: [x - 0.07, h + SHEAVE - 0.3, -2.25 + k * 0.9],
          roll: -ACROSS,
        }),
      );
  }
  for (const x of [-0.25, 0.25])
    parts.push(boxAt(SURFACES.steel, [0.05, h, 0.05], { at: [x, 0.5, 0.9] }));
  for (let y = 1; y < h; y += 0.4)
    parts.push(boxAt(SURFACES.steel, [0.5, 0.03, 0.03], { at: [0, y, 0.9] }));
  return prop(`mountains/cable-pylon-${h}`, parts);
}

/** The cabin, hanging from its grip at the origin (the cable's point). */
export function cabin(): PropMesh {
  const outline: Point2[] = Array.from({ length: 8 }, (_, i): Point2 => {
      const a = ((i + 0.5) / 8) * Math.PI * 2;
      return [Math.cos(a) * 1.35, Math.sin(a) * 1.35];
    }),
    band = (surface: typeof S.cabinRed, y: number, h: number, scale = 1) =>
      transform(extrude(surface, outline, h), { at: [0, y, 0], scale: [scale, 1, scale] });
  const parts: MeshPart[] = [
    boxAt(SURFACES.darkMetal, [0.4, 0.5, 1.2], { at: [0, -0.3, 0] }),
    transform(cylinder(SURFACES.darkMetal, 0.2, 0.1, { segments: 12 }), {
      at: [0.05, 0, -0.4],
      roll: -ACROSS,
    }),
    transform(cylinder(SURFACES.darkMetal, 0.2, 0.1, { segments: 12 }), {
      at: [0.05, 0, 0.4],
      roll: -ACROSS,
    }),
    tube(
      SURFACES.steel,
      [
        [0, -0.3, 0],
        [0.3, -1.2, 0],
        [0.9, -2.2, 0],
        [0.9, -3.4, 0],
      ],
      0.09,
      { segments: 8 },
    ),
    band(S.cabinRed, -6.2, 1.1),
    band(SURFACES.glass, -5.1, 1.0, 0.97),
    band(S.cabinRed, -4.1, 0.35),
    transform(cylinder(S.cabinRed, 1.35, 0.3, { top: 0.6, segments: 8 }), { at: [0, -3.75, 0] }),
  ];
  for (const [x, z] of outline)
    parts.push(boxAt(SURFACES.steel, [0.06, 1.0, 0.06], { at: [x * 0.99, -5.1, z * 0.99] }));
  return prop('mountains/cable-cabin', parts);
}
