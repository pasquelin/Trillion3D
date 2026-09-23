/**
 * A gate: where an airliner parks nose-in and the jet bridge that meets its forward door. The
 * bridge is drawn in the parked airliner's own frame (nose +Z, port side +X), so one node with
 * the airliner's position and yaw puts it in place: a rotunda on its column beside the terminal,
 * a short fixed link into the facade, a telescoping tunnel on a wheeled drive column, and a cab
 * turned square to the fuselage.
 */
import type { PropMesh, Vec3 } from '../../plan/contract.ts';
import { box, cylinder, prop, SURFACES, transform, tube } from '../../props/index.ts';
import { AIRPORT, LIGHTS } from './palette.ts';
import { member, wheel } from './parts.ts';
import type { Footprint } from './placer.ts';
import { BAY } from './terminal.ts';

/** The stand in the airliner's frame: the terminal face (z), the forward port door, the rotunda. */
export const GATE = {
  face: 25.2,
  door: [2.2, 2.6, 12] as Vec3,
  rotunda: [14, 22.2] as const,
  /** The airliner's own footprint: fuselage, wings with engines, tailplane. */
  airliner: [
    [0, -2.4, 2.2, 19.8],
    [0, -2.3, 17.7, 7.3],
    [0, -18.4, 6.8, 2.6],
  ] as Footprint,
};

const [RX, RZ] = GATE.rotunda,
  CAB: Vec3 = [GATE.door[0] + 3, GATE.door[1], GATE.door[2]],
  ROTUNDA_Y = BAY.upper;
const run = Math.hypot(RX - CAB[0], RZ - CAB[2]),
  heading = Math.atan2(CAB[0] - RX, CAB[2] - RZ);

export const BRIDGE_FOOTPRINT: Footprint = [
  [RX, RZ, 2.5, 2.5],
  [RX, (RZ + 2.5 + GATE.face) / 2, 1.5, (GATE.face - RZ - 2.5) / 2],
  [(RX + CAB[0]) / 2, (RZ + CAB[2]) / 2, 1.6, run / 2 - 2.6, heading],
  [CAB[0] - 1.5, CAB[2], 1.5, 1.8],
];

function tunnel() {
  const { bridgeSkin } = AIRPORT,
    along = (f: number, dy = 0): Vec3 => [
      RX + (CAB[0] - RX) * f,
      ROTUNDA_Y + (CAB[1] - ROTUNDA_Y) * f + dy,
      RZ + (CAB[2] - RZ) * f,
    ];
  const sections = [
    [0.15, 0.55, 2.9, 3.0],
    [0.5, 0.92, 2.7, 2.8],
  ].flatMap(([a, b, w, h]) => [
    member(bridgeSkin, along(a, -0.3), along(b, -0.3), [w, h]),
    member(AIRPORT.curtain, along(a, 1.5), along(b, 1.5), [w + 0.04, 0.5]),
  ]);
  const ribs = Array.from({ length: 16 }, (_, i) =>
    member(
      SURFACES.darkMetal,
      along(0.17 + i * 0.048, -0.35),
      along(0.175 + i * 0.048, -0.35),
      [3, 3.1],
    ),
  );
  const drive = along(0.8);
  return [
    ...sections,
    ...ribs,
    member(
      SURFACES.steel,
      [drive[0], 0.6, drive[2]],
      [drive[0], drive[1] - 1.8, drive[2]],
      [0.5, 0.5],
    ),
    transform(box(SURFACES.darkMetal, [3.2, 0.4, 1]), {
      at: [drive[0], 0.6, drive[2]],
      yaw: heading,
    }),
    ...[-1.3, 1.3].map((side) =>
      transform(wheel(SURFACES.rubber, [side, 0.5, 0], 0.5, 0.35, 16), {
        at: [drive[0], 0, drive[2]],
        yaw: heading,
      }),
    ),
  ];
}

function rotunda() {
  return [
    transform(cylinder(SURFACES.concrete, 0.6, ROTUNDA_Y - 1.5, { segments: 16 }), {
      at: [RX, 0, RZ],
    }),
    transform(cylinder(AIRPORT.bridgeSkin, 2.5, 3.2, { segments: 48, caps: true }), {
      at: [RX, ROTUNDA_Y - 1.5, RZ],
    }),
    transform(cylinder(AIRPORT.curtain, 2.52, 0.6, { segments: 48 }), {
      at: [RX, ROTUNDA_Y + 0.4, RZ],
    }),
    transform(box(AIRPORT.bridgeSkin, [2.8, 3, GATE.face - RZ - 2.3]), {
      at: [RX, ROTUNDA_Y - 0.3, (RZ + 2.3 + GATE.face) / 2],
    }),
  ];
}

function cab() {
  const [x, y, z] = CAB;
  return [
    transform(box(AIRPORT.bridgeSkin, [3, 3, 3.4]), { at: [x - 1.5, y - 0.3, z] }),
    transform(box(AIRPORT.curtain, [3.02, 0.6, 3.42]), { at: [x - 1.5, y + 1.5, z] }),
    // The canopy's bellows, dark and soft against the fuselage.
    transform(box(SURFACES.rubber, [0.5, 2.6, 2.6]), { at: [x - 2.9, y - 0.1, z] }),
    transform(box(LIGHTS.ceiling, [0.4, 0.05, 0.4]), { at: [x - 1.5, y + 2.75, z] }),
    tube(
      SURFACES.steel,
      [
        [x, y + 2.7, z - 1.6],
        [x, y + 3.4, z - 1.6],
        [x - 0.8, y + 3.4, z - 1.6],
      ],
      0.04,
    ),
  ];
}

export const jetBridge = (): PropMesh =>
  prop('airport/jet-bridge', [...rotunda(), ...tunnel(), ...cab()]);
