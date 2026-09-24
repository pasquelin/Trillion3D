/**
 * Alpine chalets: a stone basement that swallows the slope, a whitewashed ground floor, log
 * upper floors with shuttered windows and geraniums, carved balconies on the gable front (+Z,
 * turned to the valley), a wide shingle roof with purlins showing under the eaves, a chimney.
 * Origin: the ground-floor level at the footprint's centre; the basement reaches 3.5 m below.
 */
import type { MeshPart, PropMesh, Surface } from '../../plan/contract.ts';
import { prop, transform, tube } from '../../props/index.ts';
import { balcony, boxAt, flowerBox, gable, logWall, shingleRoof, windowUnit } from './parts.ts';
import { MOUNTAIN_SURFACES as S } from './surfaces.ts';

/** The drop a chalet's basement hides: the steepest footing it accepts. */
export const BASEMENT = 3.5;
/** The basements a landmark (church, station) may stand on, lowest first: one to three storeys. */
export const TERRACES = [BASEMENT, 2 * BASEMENT, 3 * BASEMENT];
const GROUND = 2.8;
const STOREY = 2.7;

export type ChaletSpec = {
  id: string;
  width: number;
  depth: number;
  /** Log storeys above the masonry ground floor. */
  storeys: number;
  rise: number;
  shutter: Surface;
  sideBalcony: boolean;
  /** Every n-th window is lit at night. */
  litEvery: number;
  board?: readonly [number, number];
};

/** Windows along a wall `length` long (face +Z at z = 0), one row per storey. */
function windowRows(spec: ChaletSpec, length: number, face: number, door: boolean): MeshPart[] {
  const parts: MeshPart[] = [],
    count = Math.max(1, Math.floor(length / 2.6)),
    gap = length / count;
  let n = 0;
  for (let storey = 0; storey <= spec.storeys; storey++) {
    const upper = storey > 0,
      y = storey === 0 ? 0.9 : GROUND + (storey - 1) * STOREY + 0.8,
      [w, h] = upper ? [1.0, 1.25] : [0.8, 1.05];
    for (let k = 0; k < count; k++) {
      const x = -length / 2 + gap * (k + 0.5);
      if (door && !upper && Math.abs(x) < gap / 2) continue;
      const unit = [...windowUnit(w, h, spec.shutter, ++n % spec.litEvery === 0)];
      if (upper) unit.push(...flowerBox(w));
      parts.push(...unit.map((p) => transform(p, { at: [x, y, face] })));
    }
  }
  return parts;
}

/** The door on the front, with its frame and a small canopy. */
const door = (face: number): MeshPart[] => [
  boxAt(S.darkWood, [1.1, 2.1, 0.08], { at: [0, 0, face] }),
  boxAt(S.logWood, [1.4, 0.12, 0.14], { at: [0, 2.1, face] }),
  boxAt(S.logWood, [0.12, 2.1, 0.14], { at: [-0.65, 0, face] }),
  boxAt(S.logWood, [0.12, 2.1, 0.14], { at: [0.65, 0, face] }),
  boxAt(S.shingle, [1.8, 0.08, 1.0], { at: [0, 2.45, face + 0.4], pitch: -0.3 }),
];

/** Walls, windows and balconies below the roof. */
function body(spec: ChaletSpec): MeshPart[] {
  const { width: w, depth: d, storeys } = spec,
    logs = storeys * STOREY,
    parts: MeshPart[] = [
      boxAt(S.stoneWall, [w + 0.3, BASEMENT + 0.3, d + 0.3], { at: [0, -BASEMENT, 0] }),
      boxAt(S.whitewash, [w, GROUND, d], { at: [0, 0.3, 0] }),
    ];
  const sides = [
    { yaw: 0, at: [0, d / 2], length: w, front: true },
    { yaw: Math.PI, at: [0, -d / 2], length: w, front: false },
    { yaw: Math.PI / 2, at: [w / 2, 0], length: d, front: false },
    { yaw: -Math.PI / 2, at: [-w / 2, 0], length: d, front: false },
  ] as const;
  for (const side of sides) {
    const wall = [
      ...logWall(side.length, logs).map((p) => transform(p, { at: [0, GROUND + 0.3, 0] })),
      ...windowRows(spec, side.length, 0.13, side.front),
    ];
    if (side.front) wall.push(...door(0.02));
    if (side.front || (spec.sideBalcony && side.yaw > 0 && side.yaw < 3))
      for (let storey = 1; storey <= storeys; storey++)
        wall.push(
          ...balcony(side.length + 0.4, 1.5).map((p) =>
            transform(p, { at: [0, GROUND + (storey - 1) * STOREY + 0.45, 0.15] }),
          ),
        );
    parts.push(
      ...wall.map((p) => transform(p, { at: [side.at[0], 0, side.at[1]], yaw: side.yaw })),
    );
  }
  return parts;
}

/** The roof, its gables, purlins, chimney and snow guards. */
function roof(spec: ChaletSpec): MeshPart[] {
  const { width: w, depth: d, rise } = spec,
    overhang = 1.3,
    top = GROUND + 0.3 + spec.storeys * STOREY,
    run = w / 2 + overhang,
    eave = top - (rise * overhang) / run + 0.12,
    gableRise = (rise * (w / 2)) / run,
    parts = shingleRoof(S.shingle, d, w, rise, { overhang, board: spec.board }).map((p) =>
      transform(p, { at: [0, eave, 0], yaw: Math.PI / 2 }),
    );
  for (const z of [d / 2 + 0.13, -d / 2 - 0.13])
    parts.push(
      ...gable(w, gableRise, S.logWood).map((p) =>
        transform(p, { at: [0, top, z], yaw: z > 0 ? 0 : Math.PI }),
      ),
    );
  for (const k of [-1, -0.6, -0.25, 0.25, 0.6, 1]) {
    const x = k * (w / 2),
      y = eave + rise * (1 - Math.abs(x) / run) - 0.3;
    parts.push(boxAt(S.darkWood, [0.2, 0.26, d + overhang * 2 + 0.1], { at: [x, y, 0] }));
  }
  parts.push(
    boxAt(S.darkWood, [0.24, 0.3, d + overhang * 2 + 0.1], { at: [0, eave + rise - 0.34, 0] }),
  );
  parts.push(
    boxAt(S.stoneWall, [0.7, rise + 1.6, 0.7], { at: [w * 0.22, top, -d * 0.2] }),
    boxAt(S.darkRock, [0.95, 0.12, 0.95], { at: [w * 0.22, top + rise + 1.6, -d * 0.2] }),
  );
  for (const side of [-1, 1]) {
    const x = side * (run - 1.2),
      y = eave + rise * (1.2 / run) + 0.3;
    parts.push(
      tube(
        S.darkWood,
        [
          [x, y, -d / 2 - overhang],
          [x, y, d / 2 + overhang],
        ],
        0.08,
        { segments: 6 },
      ),
    );
  }
  return parts;
}

export const chalet = (spec: ChaletSpec): PropMesh => prop(spec.id, [...body(spec), ...roof(spec)]);
