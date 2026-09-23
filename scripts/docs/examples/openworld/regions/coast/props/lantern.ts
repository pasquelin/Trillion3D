/**
 * The lighthouse's crown: the corbelled gallery with its railing, and the lantern room above it,
 * glazing between mullions round the lens, under a domed cap with a vane. Built on a tower top
 * at height `y` of radius `top`. Two pieces, so the gallery is the top of the tower's collider
 * and the lantern a narrower box of its own.
 */
import type { MeshPart } from '../../../plan/contract.ts';
import { box, cylinder, lathe, sphere, SURFACES, transform, tube } from '../../../props/index.ts';
import { COAST } from '../surfaces.ts';

/** The gallery: a slab on corbels, a railing of balusters between two rings. */
export function gallery(y: number, top: number, segments: number): MeshPart[] {
  const r = top + 1.3,
    ring = (height: number, radius: number) =>
      tube(
        SURFACES.darkMetal,
        Array.from({ length: 65 }, (_, i) => {
          const a = (i / 64) * Math.PI * 2;
          return [Math.cos(a) * radius, height, Math.sin(a) * radius] as const;
        }),
        0.04,
        { segments: 6 },
      );
  const parts: MeshPart[] = [
    transform(cylinder(COAST.granite, r, 0.4, { segments: segments }), { at: [0, y, 0] }),
    ring(y + 1.1, r - 0.1),
    ring(y + 0.6, r - 0.1),
  ];
  for (let i = 0; i < 24; i++)
    parts.push(
      transform(box(COAST.granite, [0.35, 0.9, 1.3]), {
        at: [0, y - 0.9, top + 0.5],
        yaw: (i / 24) * Math.PI * 2,
      }),
    );
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    parts.push(
      transform(cylinder(SURFACES.darkMetal, 0.025, 1.1, { segments: 5, caps: false }), {
        at: [Math.cos(a) * (r - 0.1), y + 0.4, Math.sin(a) * (r - 0.1)],
      }),
    );
  }
  return parts;
}

/** The lantern room: a low wall, glazing between mullions, the lens, a domed cap and vane. */
export function lantern(floor: number, top: number, segments: number): MeshPart[] {
  const y = floor + 0.4,
    r = top - 0.3,
    parts: MeshPart[] = [
      transform(cylinder(COAST.towerWhite, r, 1, { segments: segments }), { at: [0, y, 0] }),
      transform(cylinder(COAST.lanternGlass, r - 0.05, 2.6, { segments: 16, caps: false }), {
        at: [0, y + 1, 0],
      }),
      transform(
        lathe(
          COAST.lanternLamp,
          [
            [0, 0],
            [0.7, 0.3],
            [0.8, 0.9],
            [0.7, 1.5],
            [0, 1.8],
          ],
          { segments: 24 },
        ),
        {
          at: [0, y + 1.1, 0],
        },
      ),
      transform(
        lathe(
          COAST.towerRed,
          [
            [r + 0.3, 0],
            [r * 0.8, 0.8],
            [r * 0.45, 1.5],
            [0.2, 1.9],
            [0, 1.95],
          ],
          { segments: segments },
        ),
        {
          at: [0, y + 3.6, 0],
        },
      ),
      transform(sphere(SURFACES.darkMetal, 0.25, { segments: 10, rings: 6 }), {
        at: [0, y + 5.7, 0],
      }),
      transform(cylinder(SURFACES.darkMetal, 0.03, 1.6, { segments: 5 }), { at: [0, y + 5.8, 0] }),
    ];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    parts.push(
      transform(box(SURFACES.darkMetal, [0.08, 2.6, 0.08]), {
        at: [Math.cos(a) * r, y + 1, Math.sin(a) * r],
      }),
    );
  }
  return parts;
}
