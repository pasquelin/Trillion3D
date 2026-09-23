/**
 * The lighthouse on the headland: an octagonal granite base, a tapering tower painted in red and
 * white bands with a door and a spiral of small windows, a corbelled gallery with a railing, a
 * glazed lantern room with its mullions, lens and domed cap, and the keeper's cottage beside it.
 * Origin at the foot of the tower; the cottage stands toward -Z, the sea side is +Z.
 */
import type { MeshPart, PropMesh } from '../../../plan/contract.ts';
import { box, lathe, prop, SURFACES, transform, type PropLamp } from '../../../props/index.ts';
import { COAST } from '../surfaces.ts';
import { house } from './houses.ts';
import { gallery, lantern } from './lantern.ts';

const BASE = 2.5,
  TOWER = 30,
  FOOT = 4.2,
  TOP = 2.9,
  SEGMENTS = 128;

/** Heights a region reads: the gallery floor (a viewpoint) and the lamp (the beam's origin). */
export const LIGHTHOUSE = {
  gallery: BASE + TOWER + 0.4,
  lamp: BASE + TOWER + 2.3,
  radius: FOOT + 2,
} as const;

/** The lantern: a night light seen far out at sea, 1 000 000 cd as a major light states it. */
export const LIGHTHOUSE_LAMPS: readonly PropLamp[] = [
  {
    id: 'lantern',
    type: 'point',
    offset: [0, LIGHTHOUSE.lamp, 0],
    color: [1, 0.9, 0.62],
    intensity: 1_000_000,
    range: 20_000,
    night: true,
  },
];

const radiusAt = (y: number) => FOOT + (TOP - FOOT) * (y / TOWER);

/** The tower's shaft in six alternating bands, each a turned section of the taper. */
function shaft(): MeshPart[] {
  const bands = 6;
  return Array.from({ length: bands }, (_, i) => {
    const y0 = (i / bands) * TOWER,
      y1 = ((i + 1) / bands) * TOWER;
    return transform(
      lathe(
        i % 2 ? COAST.towerRed : COAST.towerWhite,
        [
          [radiusAt(y0), y0],
          [radiusAt((y0 + y1) / 2) + 0.02, (y0 + y1) / 2],
          [radiusAt(y1), y1],
        ],
        { segments: SEGMENTS, caps: false },
      ),
      { at: [0, BASE, 0] },
    );
  });
}

/** A spiral of small windows following the stair inside, and the door at the foot. */
function openings(): MeshPart[] {
  const parts: MeshPart[] = [];
  for (let i = 0; i < 7; i++) {
    const y = 5 + i * 3.6,
      r = radiusAt(y) - 0.05,
      turn = i * 0.9;
    const frame = [
      transform(box(SURFACES.glass, [0.6, 1.1, 0.3]), { at: [0, BASE + y, r] }),
      transform(box(COAST.whitewash, [0.8, 0.12, 0.4]), { at: [0, BASE + y - 0.12, r] }),
      transform(box(COAST.whitewash, [0.8, 0.12, 0.4]), { at: [0, BASE + y + 1.1, r] }),
    ];
    parts.push(...frame.map((part) => transform(part, { yaw: turn })));
  }
  parts.push(
    transform(box(SURFACES.wood, [1.2, 2.3, 0.4]), { at: [0, BASE, FOOT - 0.1] }),
    transform(box(COAST.granite, [1.6, 0.3, 0.6]), { at: [0, BASE + 2.3, FOOT] }),
  );
  return parts;
}

export const lighthouse = (seed: number): PropMesh =>
  prop('coast-lighthouse', [
    lathe(
      COAST.granite,
      [
        [FOOT + 2, -1.5],
        [FOOT + 2, BASE - 0.3],
        [FOOT + 1.6, BASE],
        [0, BASE],
      ],
      { segments: 8, shading: 'flat' },
    ),
    ...shaft(),
    ...openings(),
    ...gallery(BASE + TOWER, TOP, SEGMENTS),
    ...house('coast-lighthouse-cottage', {
      width: 9,
      depth: 6,
      floors: 1,
      wall: COAST.whitewash,
      roof: SURFACES.slate,
      shutter: COAST.towerRed,
      balcony: false,
      seed,
    }).parts.map((part) => transform(part, { at: [0, 0, -(FOOT + 2 + 4.5)] })),
  ]);

/** The lantern room on the gallery, placed with the tower at the same origin and yaw. */
export const lighthouseLantern = (): PropMesh =>
  prop('coast-lighthouse-lantern', lantern(BASE + TOWER, TOP, SEGMENTS));
