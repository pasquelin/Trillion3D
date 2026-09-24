/** A 10 m sloop, bow toward +Z, origin on the waterline: hull, keel, rig, billowed sails. */
import type { MeshPart, PropMesh, Vec3 } from '../plan/contract.ts';
import { hull } from './hull.ts';
import { cylinder, lathe, tube, type ProfilePoint } from './round.ts';
import { sheet } from './shapes.ts';
import { bevelExtrude, roundedBox } from './smooth.ts';
import { SURFACES } from './surfaces.ts';
import { prop, transform } from './transform.ts';

const { hullWhite, whitePaint, glass, darkMetal, steel, sail } = SURFACES;

/** A billowed triangular sail in the YZ plane: `tack` and `clew` on the boom, `head` aloft. */
function sailOf(tack: Vec3, clew: Vec3, head: Vec3, depth: number): MeshPart {
  return sheet(sail, 20, 24, (u, v) => {
    const w = u * (1 - v),
      p = [0, 1, 2].map((k) => tack[k] + (clew[k] - tack[k]) * w + (head[k] - tack[k]) * v);
    return [
      p[0] +
        depth *
          Math.sin(Math.PI * Math.min(1, u)) *
          (1 - v) *
          Math.sin(Math.PI * (1 - v) * 0.5 + 0.5),
      p[1],
      p[2],
    ];
  });
}

/** Stanchions every metre along both sides, joined by a lifeline. */
export function rails(
  from: number,
  to: number,
  halfBeam: (z: number) => number,
  deck: number,
): MeshPart[] {
  const posts = Math.round(to - from),
    out: MeshPart[] = [];
  for (const side of [-1, 1]) {
    const line: Vec3[] = [];
    for (let i = 0; i <= posts; i++) {
      const z = from + ((to - from) * i) / posts,
        x = side * halfBeam(z);
      out.push(
        transform(cylinder(steel, 0.015, 0.6, { segments: 8, caps: false }), { at: [x, deck, z] }),
      );
      line.push([x, deck + 0.6, z]);
    }
    out.push(tube(steel, line, 0.008, { segments: 6 }));
  }
  return out;
}

export function sailboat(): PropMesh {
  const beam = (z: number) => 1.45 * Math.sqrt(Math.max(0.05, 1 - Math.max(0, z / 5) ** 2)),
    mast: ProfilePoint[] = [
      [0.09, 0],
      [0.08, 7],
      [0.05, 14],
      [0.02, 14.1],
    ];
  return prop('sailboat', [
    hull(hullWhite, {
      length: 10,
      beam: 3.2,
      draft: 0.7,
      freeboard: 0.8,
      fullness: 0.45,
      around: 48,
      along: 80,
    }),
    bevelExtrude(
      darkMetal,
      [
        [-0.7, -0.6],
        [0.5, -0.6],
        [0.2, -2.2],
        [-0.6, -2.2],
      ],
      0.18,
      { bevel: 0.06, segments: 3, smooth: 2 },
    ),
    transform(
      bevelExtrude(
        darkMetal,
        [
          [-4.6, 0],
          [-4.2, 0],
          [-4.3, -1.2],
          [-4.6, -1.1],
        ],
        0.06,
        { bevel: 0.02, segments: 2, smooth: 1 },
      ),
      { yaw: -Math.PI / 2 },
    ),
    transform(roundedBox(whitePaint, [1.9, 0.55, 3], 0.18, 3), { at: [0, 0.75, -0.8] }),
    transform(roundedBox(glass, [1.92, 0.18, 1.8], 0.05, 2), { at: [0, 1.05, -0.6] }),
    transform(lathe(steel, mast, { segments: 16 }), { at: [0, 0.8, 0.6] }),
    tube(
      steel,
      [
        [0, 2.4, 0.6],
        [0, 2.4, -3.6],
      ],
      0.06,
      { segments: 10, caps: true },
    ),
    sailOf([0, 2.5, 0.5], [0, 2.5, -3.5], [0, 14.5, 0.5], 0.35),
    sailOf([0, 1.3, 4.6], [0, 1.4, 1], [0, 13.6, 0.7], 0.3),
    tube(
      steel,
      [
        [0, 14.8, 0.6],
        [0, 1.2, 4.8],
      ],
      0.008,
      { segments: 5 },
    ),
    tube(
      steel,
      [
        [0, 14.8, 0.6],
        [0, 1.1, -4.8],
      ],
      0.008,
      { segments: 5 },
    ),
    ...[-1, 1].map((s) =>
      tube(
        steel,
        [
          [s * 1.5, 0.9, 0.4],
          [0, 11.5, 0.6],
        ],
        0.008,
        { segments: 5 },
      ),
    ),
    ...rails(-4.2, 3.6, beam, 0.85),
    ...[-1, 1].map((s) =>
      transform(
        lathe(
          darkMetal,
          [
            [0.1, 0],
            [0.09, 0.14],
            [0.06, 0.16],
            [0.02, 0.2],
          ],
          { segments: 16 },
        ),
        { at: [s * 0.9, 0.85, -2.6] },
      ),
    ),
  ]);
}
