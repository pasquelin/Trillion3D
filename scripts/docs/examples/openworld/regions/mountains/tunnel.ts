/**
 * Where a mountain road goes through a ridge: a tunnel portal — a stone headwall with its arch
 * of voussoirs, wing walls, a lined bore that fades to dark, sodium lamps — sized to the road
 * it carries. The road runs along Z at y = 0, the portal's face at z = 0 looking out along +Z.
 */
import type { MeshPart, PropMesh, Vec3 } from '../../plan/contract.ts';
import { hash01, prop, quads, type PropLamp } from '../../props/index.ts';
import { boxAt } from './parts.ts';
import { MOUNTAIN_SURFACES as S } from './surfaces.ts';

const SPRING = 4.5;
const BORE = 30;
const TUNNEL_LAMP_Z = [-4, -14, -24];

/** The half clear width of a bore over a road `width` wide (a 1 m walkway each side). */
const clear = (width: number) => width / 2 + 1;

/** Arch angles from the right springing to the left one, with the headwall's corners among them. */
function archAngles(corner: number): number[] {
  const angles = Array.from({ length: 25 }, (_, i) => (i / 24) * Math.PI);
  return [...angles, corner, Math.PI - corner].sort((a, b) => a - b);
}

export function tunnelPortal(width: number): PropMesh {
  const a = clear(width),
    outer = a + 3.5,
    top = SPRING + a + 2.5,
    corner = Math.atan2(top - SPRING, outer),
    angles = archAngles(corner),
    arch = (t: number, r: number, z = 0): Vec3 => [Math.cos(t) * r, SPRING + Math.sin(t) * r, z],
    reach = (t: number) =>
      Math.min(
        outer / Math.max(1e-6, Math.abs(Math.cos(t))),
        (top - SPRING) / Math.max(1e-6, Math.sin(t)),
      );
  const face: Vec3[][] = [],
    lining: Vec3[][] = [];
  for (let i = 0; i + 1 < angles.length; i++) {
    const [t0, t1] = [angles[i], angles[i + 1]];
    face.push([arch(t0, a), arch(t0, reach(t0)), arch(t1, reach(t1)), arch(t1, a)]);
    lining.push([arch(t0, a), arch(t1, a), arch(t1, a, -BORE), arch(t0, a, -BORE)]);
  }
  lining.push(
    [
      [a, 0, 0],
      [a, SPRING, 0],
      [a, SPRING, -BORE],
      [a, 0, -BORE],
    ],
    [
      [-a, 0, 0],
      [-a, 0, -BORE],
      [-a, SPRING, -BORE],
      [-a, SPRING, 0],
    ],
  );
  const parts: MeshPart[] = [
    quads(S.stoneWall, face),
    quads(S.concrete, lining),
    quads(S.tunnelDark, [
      [
        [-a, 0, -BORE],
        [a, 0, -BORE],
        [a, SPRING + a, -BORE],
        [-a, SPRING + a, -BORE],
      ],
    ]),
    boxAt(S.stoneWall, [outer - a, SPRING, 1.2], { at: [(a + outer) / 2, 0, -0.6] }),
    boxAt(S.stoneWall, [outer - a, SPRING, 1.2], { at: [-(a + outer) / 2, 0, -0.6] }),
    boxAt(S.concrete, [outer * 2 + 0.4, 0.5, 1.6], { at: [0, top, -0.5] }),
  ];
  for (const side of [-1, 1])
    parts.push(
      boxAt(S.stoneWall, [0.8, top * 0.6, 9], {
        at: [side * (outer - 0.4), 0, 4.2],
        yaw: side * 0.3,
      }),
    );
  for (let k = 0; k < 19; k++) {
    const t = ((k + 0.5) / 19) * Math.PI,
      [x, y] = arch(t, a);
    parts.push(boxAt(S.granite, [0.42, 0.9, 0.25], { at: [x, y, 0.05], roll: t - Math.PI / 2 }));
  }
  for (let row = 0, y = 0.05; y < top - 0.3; row++, y += 0.5)
    for (let x = -outer + 0.5 + (row % 2) * 0.5; x < outer - 0.4; x += 1) {
      const r = Math.hypot(x, y + 0.22 - SPRING);
      if ((y + 0.22 > SPRING && r < a + 0.95) || (y + 0.22 <= SPRING && Math.abs(x) < a + 0.5))
        continue;
      parts.push(
        boxAt(S.granite, [0.94, 0.45, 0.1 + 0.08 * hash01(7, row, Math.round(x * 2))], {
          at: [x, y, 0],
        }),
      );
    }
  for (const z of TUNNEL_LAMP_Z)
    parts.push(boxAt(S.sodium, [0.6, 0.12, 0.3], { at: [0, SPRING + a - 0.2, z] }));
  return prop(`mountains/tunnel-portal-${width}`, parts);
}

/** The bore's sodium lamps: tunnels are lit day and night. */
export const PORTAL_LAMPS = (width: number): PropLamp[] =>
  TUNNEL_LAMP_Z.map((z, k) => ({
    id: `lamp-${k}`,
    type: 'point' as const,
    offset: [0, SPRING + clear(width) - 0.4, z] as Vec3,
    color: [1, 0.55, 0.15] as const,
    intensity: 400,
    range: 16,
    night: false,
  }));
