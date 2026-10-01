import { box } from '../world/geometry/basic.ts';
import { Mesh } from '../world/object/mesh.ts';
import { createCharacterBody } from './characterBody.ts';
import { meshCollision } from './meshTriangles.ts';
import { HUMAN_BODY, type CharacterInput, type CharacterSettings } from './characterSettings.ts';

/** An axis-aligned solid between two world-space corners. */
export function block(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  const mesh = new Mesh(box(x1 - x0, y1 - y0, z1 - z0));
  mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return mesh;
}

/** No key held, and the walking key east. */
export const STILL = { wishX: 0, wishZ: 0, sprint: false },
  EAST = { wishX: 1, wishZ: 0, sprint: false };

/** A wide floor whose top is at height 0. */
export const FLOOR = () => block(-50, -1, -50, 50, 0, 50);

/** A body of the default human over `blocks`, feet at `(x, y, z)`. */
export function body(
  blocks: Mesh[],
  x = 0,
  y = 0,
  z = 0,
  changes: Partial<CharacterSettings> = {},
) {
  const settings = { ...HUMAN_BODY, ...changes };
  const made = createCharacterBody(settings);
  made.setWorld(meshCollision(blocks));
  made.place(x, y, z);
  return made;
}

/** Lives `seconds` in frames of `frame` seconds; returns the last drawn feet. */
export function live(
  made: ReturnType<typeof body>,
  seconds: number,
  input: CharacterInput,
  frame = 1 / 60,
) {
  let feet = made.feet;
  for (let t = 0; t < seconds - 1e-9; t += frame) feet = made.advance(frame, input);
  return [...feet];
}
