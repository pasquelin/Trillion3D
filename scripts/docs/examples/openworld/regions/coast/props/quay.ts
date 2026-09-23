/**
 * A stone quay bay of the island port, 10 m along X with the water at +Z: a dressed wall down
 * to the sea bed, granite coping, two bollards, an iron ladder, and on one variant a lamp.
 * Origin on the walking surface at the bay's centre.
 */
import type { MeshPart, PropMesh } from '../../../plan/contract.ts';
import {
  box,
  lathe,
  prop,
  roundedBox,
  SURFACES,
  transform,
  type PropLamp,
} from '../../../props/index.ts';
import { COAST } from '../surfaces.ts';
import { lampAt, lampStandard } from './lamp-standard.ts';
import { PIER } from './pier.ts';

/** A 10 m quay bay: a dressed stone wall to the water, coping, two bollards, a ladder. */
function quayBay(id: string, lamp: boolean): PropMesh {
  const L = PIER.quay,
    D = PIER.quayDepth,
    parts: MeshPart[] = [
      transform(box(COAST.quayStone, [L, PIER.piles, D]), { at: [0, -PIER.piles, 0] }),
    ];
  for (let course = 1; course < 8; course++)
    parts.push(transform(box(COAST.granite, [L, 0.06, 0.04]), { at: [0, -course * 0.7, D / 2] }));
  for (let i = 0; i < 5; i++)
    parts.push(
      transform(roundedBox(COAST.granite, [L / 5 - 0.04, 0.3, 0.9], 0.05, 2), {
        at: [-L / 2 + (i + 0.5) * (L / 5), 0, D / 2 - 0.45],
      }),
    );
  for (const x of [-L / 4, L / 4])
    parts.push(
      transform(
        lathe(
          SURFACES.darkMetal,
          [
            [0.2, 0],
            [0.14, 0.5],
            [0.22, 0.6],
            [0.2, 0.7],
            [0, 0.72],
          ],
          { segments: 12 },
        ),
        { at: [x, 0.3, D / 2 - 0.5] },
      ),
    );
  for (const x of [-0.25, 0.25])
    parts.push(
      transform(box(SURFACES.darkMetal, [0.04, 4, 0.04]), { at: [x + L * 0.4, -3.7, D / 2 + 0.1] }),
    );
  for (let r = 0; r < 12; r++)
    parts.push(
      transform(box(SURFACES.darkMetal, [0.5, 0.03, 0.03]), {
        at: [L * 0.4, -3.5 + r * 0.33, D / 2 + 0.1],
      }),
    );
  if (lamp) parts.push(...lampStandard(0, -D / 2 + 0.6));
  return prop(id, parts);
}

export const QUAY_LAMPS: readonly PropLamp[] = [lampAt('lamp', 0, -PIER.quayDepth / 2 + 0.6)];

export const quayProps = (): PropMesh[] => [
  quayBay('coast-quay-bay', false),
  quayBay('coast-quay-bay-lamp', true),
];
