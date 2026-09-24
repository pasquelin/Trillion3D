/**
 * A bay of the coast's stone bridges: a 12 m arch of dressed granite carrying a deck between
 * two parapets, its pier reaching `BRIDGE.pier` below the deck to the valley floor. The bay runs
 * along Z and is `BRIDGE.width` wide across X; a narrower road scales it across. Origin on the
 * deck at the bay's centre; bays set end to end make a viaduct.
 */
import type { MeshPart, PropMesh } from '../../../plan/contract.ts';
import {
  bevelExtrude,
  box,
  prop,
  roundedBox,
  SURFACES,
  transform,
  type Point2,
} from '../../../props/index.ts';
import { COAST } from '../surfaces.ts';

export const BRIDGE = { bay: 12, width: 9, pier: 40 } as const;

/** The arched wall's outline in the bay's side plane: x along the bay, y down from the deck. */
function archOutline(): Point2[] {
  const half = BRIDGE.bay / 2,
    radius = 4.6,
    spring = -8,
    steps = 16,
    arc = Array.from({ length: steps + 1 }, (_, i): Point2 => {
      const a = (i / steps) * Math.PI;
      return [Math.cos(a) * radius, spring + Math.sin(a) * radius];
    });
  return [
    [-half, -0.6],
    [-half, -BRIDGE.pier],
    [-radius, -BRIDGE.pier],
    ...arc.reverse(),
    [radius, -BRIDGE.pier],
    [half, -BRIDGE.pier],
    [half, -0.6],
  ];
}

export function bridgeBay(): PropMesh {
  const w = BRIDGE.width,
    parts: MeshPart[] = [
      // The arched wall, turned so its side plane runs along Z and its thickness across X.
      transform(bevelExtrude(COAST.granite, archOutline(), w - 0.6, { bevel: 0.15, segments: 2 }), {
        yaw: Math.PI / 2,
      }),
      transform(box(SURFACES.asphalt, [w - 1.4, 0.3, BRIDGE.bay]), { at: [0, -0.3, 0] }),
      transform(roundedBox(COAST.quayStone, [w, 0.35, BRIDGE.bay], 0.08, 2), { at: [0, -0.65, 0] }),
    ];
  for (const side of [-1, 1]) {
    const x = side * (w / 2 - 0.35);
    parts.push(
      transform(roundedBox(COAST.granite, [0.5, 0.9, BRIDGE.bay], 0.08, 2), { at: [x, -0.3, 0] }),
      transform(roundedBox(COAST.quayStone, [0.7, 0.18, BRIDGE.bay], 0.06, 2), {
        at: [x, 0.6, 0],
      }),
    );
    for (const z of [-4, 0, 4])
      parts.push(
        transform(roundedBox(COAST.quayStone, [0.8, 0.8, 0.8], 0.1, 2), {
          at: [side * (w / 2 - 0.1), -9, z],
        }),
      );
  }
  return prop('coast-bridge-bay', parts);
}
