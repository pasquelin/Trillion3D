/**
 * A 200 × 160 m football stadium: an oval bowl of 22 stepped tiers of red seats inside a ribbed
 * facade, a cantilevered roof ring on radial trusses, and a marked pitch. Built round, then
 * stretched 1.25 × along X into an oval; the floodlight masts that light it are placed beside it.
 */
import type { MeshPart, PropMesh, Vec3 } from '../../plan/contract.ts';
import {
  box,
  cylinder,
  lathe,
  prop,
  quads,
  SURFACES,
  transform,
  tube,
  type ProfilePoint,
} from '../../props/index.ts';
import type { Xz } from './frame.ts';
import { CITY } from './surfaces.ts';
import { FOUNDATION } from './tower-kit.ts';

const STRETCH = 1.25;
const OUTER = 80;
const SEGMENTS = 64;

/** Seating from the top rim down to the pitch: a riser down, a tread inward, 22 times. */
function tiers(): ProfilePoint[] {
  const profile: ProfilePoint[] = [],
    steps = 22,
    rise = 25 / steps,
    run = 34 / steps;
  let r = OUTER - 2,
    y = 26;
  profile.push([r, y]);
  for (let i = 0; i < steps; i++) {
    y -= rise;
    profile.push([r, y]);
    r -= run;
    profile.push([r, y]);
  }
  return profile;
}

/** A low seat back along the front of every tread, so each tier reads as a row of seats. */
function seatBacks(): MeshPart[] {
  const profile = tiers();
  const backs: MeshPart[] = [];
  for (let k = 2; k < profile.length; k += 2) {
    const [r, y] = profile[k];
    backs.push(
      lathe(
        CITY.seat,
        [
          [r + 0.55, y],
          [r + 0.5, y + 0.45],
          [r + 0.4, y + 0.45],
        ],
        { segments: SEGMENTS, caps: false },
      ),
    );
  }
  return backs;
}

/** Pitch markings: touchlines, halfway line and centre circle, as flat strips. */
function markings(y: number): MeshPart {
  const strip = (x0: number, z0: number, x1: number, z1: number): Vec3[] => [
    [x0, y, z0],
    [x0, y, z1],
    [x1, y, z1],
    [x1, y, z0],
  ];
  const faces = [
    strip(-52.5, -34, 52.5, -33.8),
    strip(-52.5, 33.8, 52.5, 34),
    strip(-52.5, -34, -52.3, 34),
    strip(52.3, -34, 52.5, 34),
    strip(-0.1, -34, 0.1, 34),
  ];
  for (let i = 0; i < 32; i++) {
    const a = (i * Math.PI * 2) / 32,
      b = ((i + 1) * Math.PI * 2) / 32,
      p = (r: number, t: number): Vec3 => [r * Math.cos(t), y, r * Math.sin(t)];
    faces.push([p(9.15, a), p(8.95, a), p(8.95, b), p(9.15, b)]);
  }
  return quads(CITY.zebra, faces);
}

function bowl(): MeshPart[] {
  const ribs = Array.from({ length: 32 }, (_, i) => {
    const a = (i * Math.PI * 2) / 32,
      at = (r: number, y: number): Vec3 => [r * Math.cos(a), y, r * Math.sin(a)];
    return [
      tube(SURFACES.steel, [at(OUTER + 1.5, 0), at(OUTER + 1.5, 31)], 0.5, { segments: 6 }),
      tube(SURFACES.steel, [at(OUTER + 1.5, 31), at(58, 35)], 0.35, { segments: 6 }),
    ];
  }).flat();
  return [
    transform(cylinder(CITY.renderGrey, OUTER + 2, FOUNDATION + 0.5, { segments: SEGMENTS }), {
      at: [0, -FOUNDATION, 0],
    }),
    lathe(
      CITY.renderGrey,
      [
        [OUTER + 1, 0.5],
        [OUTER, 26],
        [OUTER - 2, 26.5],
      ],
      { segments: SEGMENTS, caps: false },
    ),
    lathe(CITY.seat, tiers(), { segments: SEGMENTS, caps: false }),
    ...seatBacks(),
    lathe(
      CITY.glassDark,
      [
        [OUTER + 0.8, 8],
        [OUTER + 0.8, 10.5],
      ],
      { segments: SEGMENTS, caps: false },
    ),
    lathe(
      SURFACES.whitePaint,
      [
        [OUTER + 3, 31],
        [58, 35],
      ],
      { segments: SEGMENTS, caps: false },
    ),
    lathe(
      SURFACES.whitePaint,
      [
        [58, 34.7],
        [OUTER + 3, 30.7],
      ],
      { segments: SEGMENTS, caps: false },
    ),
    ...ribs,
  ];
}

/** The stadium prop and its ground half extents. */
export function stadium(): { prop: PropMesh; half: Xz } {
  const round = bowl().map((part) => transform(part, { scale: [STRETCH, 1, 1] }));
  return {
    prop: prop('city/stadium', [
      ...round,
      transform(box(CITY.pitch, [108, 0.3, 76]), { at: [0, 0.5, 0] }),
      markings(0.82),
      ...[-1, 1].map((s) =>
        transform(box(SURFACES.whitePaint, [0.12, 2.44, 7.3]), { at: [s * 52.5, 0.8, 0] }),
      ),
    ]),
    half: [(OUTER + 3.5) * STRETCH, OUTER + 3.5],
  };
}
