/**
 * Building parts every mountain building shares: a shingle roof laid board by board, a log
 * wall, a window with its frame, cross and shutters, a carved balcony. All stand on y = 0 in
 * their own frame; the builders move them into place.
 */
import type { MeshPart, Surface, Vec3 } from '../../plan/contract.ts';
import {
  box,
  cylinder,
  quads,
  roofPrism,
  SURFACES,
  transform,
  type Trs,
} from '../../props/index.ts';
import { MOUNTAIN_SURFACES as S } from './surfaces.ts';

/** A box of `size` moved by `trs`. */
export const boxAt = (surface: Surface, size: Vec3, trs: Trs) => transform(box(surface, size), trs);

/**
 * A pitched roof, ridge along X at `rise` above the eaves, eaves `overhang` past a `width` ×
 * `depth` footprint (eaves at y = 0): a deck under staggered boards, each `board` wide and long,
 * lapped by a third, plus a ridge cap.
 */
export function shingleRoof(
  surface: Surface,
  width: number,
  depth: number,
  rise: number,
  { overhang = 1, board = [0.6, 0.5] as readonly [number, number], deck = S.darkWood } = {},
): MeshPart[] {
  const run = depth / 2 + overhang,
    angle = Math.atan2(rise, run),
    slope = Math.hypot(rise, run),
    along = width + overhang * 2,
    [bw, bl] = board,
    lap = bl * (2 / 3),
    rows = Math.ceil((slope - bl) / lap) + 1,
    parts: MeshPart[] = [roofPrism(deck, width, depth, rise - 0.02, { overhang })];
  for (const side of [0, Math.PI]) {
    const boards: MeshPart[] = [];
    for (let row = 0; row < rows; row++) {
      const s = Math.min(slope - bl / 2, bl / 2 + row * lap),
        count = Math.ceil(along / bw) + (row % 2),
        start = -along / 2 + (row % 2 ? -bw / 2 : 0) + bw / 2;
      for (let k = 0; k < count; k++) {
        const x = Math.max(-along / 2 + bw / 4, Math.min(along / 2 - bw / 4, start + k * bw));
        boards.push(
          boxAt(surface, [bw * 0.94, 0.03, bl], {
            at: [x, rise - s * Math.sin(angle) + 0.02 + (row % 2) * 0.005, s * Math.cos(angle)],
            pitch: angle,
          }),
        );
      }
    }
    parts.push(...boards.map((b) => transform(b, { yaw: side })));
  }
  parts.push(boxAt(surface, [along, 0.12, 0.34], { at: [0, rise - 0.02, 0] }));
  return parts;
}

/** A wall of horizontal round logs along X, `length` × `height`, its face at z = 0. */
export function logWall(length: number, height: number, log = 0.24): MeshPart[] {
  const parts = [boxAt(S.logWood, [length, height, 0.1], { at: [0, 0, -0.05] })];
  for (let y = log / 2; y < height; y += log)
    parts.push(
      transform(cylinder(S.logWood, log / 2, length + 0.5, { segments: 6 }), {
        at: [-(length + 0.5) / 2, y, 0],
        roll: -Math.PI / 2,
      }),
    );
  return parts;
}

/**
 * A window `w` × `h` facing +Z, its bottom at y = 0: frame, cross, glass (lit or not), sill and
 * two louvred shutters folded open beside it.
 */
export function windowUnit(w: number, h: number, shutter: Surface, lit: boolean): MeshPart[] {
  const t = 0.07,
    glass = lit ? SURFACES.emissiveWindow : SURFACES.glass,
    parts = [
      boxAt(glass, [w, h, 0.02], { at: [0, 0, 0.02] }),
      boxAt(S.darkWood, [w + t * 2, t, 0.12], { at: [0, h, 0.05] }),
      boxAt(S.darkWood, [t, h, 0.12], { at: [-w / 2 - t / 2, 0, 0.05] }),
      boxAt(S.darkWood, [t, h, 0.12], { at: [w / 2 + t / 2, 0, 0.05] }),
      boxAt(S.darkWood, [w, 0.05, 0.08], { at: [0, h / 2, 0.05] }),
      boxAt(S.darkWood, [0.05, h, 0.08], { at: [0, 0, 0.05] }),
      boxAt(S.darkWood, [w + 0.3, 0.06, 0.3], { at: [0, -0.06, 0.12] }),
    ];
  for (const side of [-1, 1]) {
    const x = side * (w / 2 + t + w / 4);
    parts.push(boxAt(shutter, [w / 2, h, 0.03], { at: [x, 0, 0.1] }));
    for (let y = 0.1; y < h - 0.05; y += 0.12)
      parts.push(boxAt(shutter, [w / 2 - 0.08, 0.03, 0.05], { at: [x, y, 0.13], pitch: -0.5 }));
  }
  return parts;
}

/** A red flower box under a window `w` wide, its top at y = 0. */
export const flowerBox = (w: number): MeshPart[] => [
  boxAt(S.darkWood, [w + 0.2, 0.25, 0.25], { at: [0, -0.25, 0.3] }),
  boxAt(S.geranium, [w + 0.1, 0.2, 0.3], { at: [0, 0, 0.3] }),
  boxAt(S.meadow, [w + 0.14, 0.08, 0.34], { at: [0, -0.02, 0.3] }),
];

/**
 * A balcony along X, `length` long, `depth` out toward +Z from z = 0, its floor at y = 0:
 * slab, carved boards between two rails, returns at both ends, brackets underneath.
 */
export function balcony(length: number, depth: number): MeshPart[] {
  const parts = [boxAt(S.darkWood, [length, 0.12, depth], { at: [0, -0.12, depth / 2] })],
    rail = (y: number, z: number, l: number, yaw = 0, x = 0) =>
      boxAt(S.darkWood, [l, 0.08, 0.1], { at: [x, y, z], yaw });
  parts.push(rail(1.0, depth - 0.05, length), rail(0.08, depth - 0.05, length));
  const carved = (x: number, z: number, yaw: number) => [
    boxAt(S.logWood, [0.1, 0.84, 0.025], { at: [x, 0.12, z], yaw }),
    boxAt(S.logWood, [0.14, 0.12, 0.03], { at: [x, 0.5, z], yaw }),
  ];
  for (let x = -length / 2 + 0.1; x < length / 2 - 0.05; x += 0.15)
    parts.push(...carved(x, depth - 0.05, 0));
  for (const side of [-1, 1]) {
    const x = side * (length / 2 - 0.05);
    parts.push(
      rail(1.0, depth / 2, depth, Math.PI / 2, x),
      rail(0.08, depth / 2, depth, Math.PI / 2, x),
    );
    for (let z = 0.15; z < depth - 0.1; z += 0.15) parts.push(...carved(x, z, Math.PI / 2));
  }
  for (let x = -length / 2 + 0.3; x < length / 2; x += 1.8)
    parts.push(
      boxAt(S.darkWood, [0.12, 0.12, depth * 1.2], { at: [x, -0.8, depth / 2 - 0.1], pitch: -0.6 }),
    );
  return parts;
}

/** A gable triangle `width` wide and `rise` high over y = 0, faced with vertical battens (+Z). */
export function gable(width: number, rise: number, surface: Surface): MeshPart[] {
  const half = width / 2,
    parts = [
      quads(surface, [
        [
          [-half, 0, 0],
          [half, 0, 0],
          [0, rise, 0],
        ],
      ]),
    ];
  for (let x = -half + 0.2; x < half - 0.1; x += 0.35) {
    const h = rise * (1 - Math.abs(x) / half) - 0.05;
    if (h > 0.1) parts.push(boxAt(S.darkWood, [0.06, h, 0.04], { at: [x, 0, 0.02] }));
  }
  return parts;
}
