import test from 'node:test';
import assert from 'node:assert/strict';
import { box } from '../world/geometry/basic.ts';
import { Mesh } from '../world/object/mesh.ts';
import { meshCollision } from './meshTriangles.ts';
import { createCharacterBody } from './characterBody.ts';
import { HUMAN_BODY, type CharacterInput, type CharacterSettings } from './characterSettings.ts';

/** An axis-aligned block from its two corners, as a mesh the collision world reads. */
function block(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  const mesh = new Mesh(box(x1 - x0, y1 - y0, z1 - z0));
  mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return mesh;
}

const FLOOR = () => block(-50, -1, -50, 50, 0, 50);
const STILL: CharacterInput = { wishX: 0, wishZ: 0, sprint: false };
const EAST: CharacterInput = { wishX: 1, wishZ: 0, sprint: false };

/** A body of the default human over `blocks`, feet at `(x, y, z)`. */
function body(blocks: Mesh[], x = 0, y = 0, z = 0, changes: Partial<CharacterSettings> = {}) {
  const settings = { ...HUMAN_BODY, ...changes };
  const made = createCharacterBody(settings);
  made.setWorld(meshCollision(blocks));
  made.place(x, y, z);
  return made;
}

/** Lives `seconds` in frames of `frame` seconds; returns the last drawn feet. */
function live(
  made: ReturnType<typeof body>,
  seconds: number,
  input: CharacterInput,
  frame = 1 / 60,
) {
  let feet = made.feet;
  for (let t = 0; t < seconds - 1e-9; t += frame) feet = made.advance(frame, input);
  return [...feet];
}

test('a body falls, lands on the floor and reports the impact once', () => {
  const made = body([FLOOR()], 0, 2, 0);
  const impacts: number[] = [];
  for (let i = 0; i < 120; i++) made.advance(1 / 60, STILL, { onLand: (v) => impacts.push(v) });
  assert.ok(Math.abs(made.feet[1]) < 1e-6, `feet at ${made.feet[1]}`);
  assert.equal(made.onGround, true);
  assert.equal(impacts.length, 1);
  // Free fall from 2 m: sqrt(2 g h), read within one tick of gravity.
  assert.ok(Math.abs(impacts[0] - Math.sqrt(2 * HUMAN_BODY.gravity * 2)) < 0.1);
});

test('a wall stops the body, which slides along it', () => {
  const made = body([FLOOR(), block(1, 0, -20, 1.2, 3, 20)]);
  const feet = live(made, 3, { wishX: Math.SQRT1_2, wishZ: Math.SQRT1_2, sprint: false });
  assert.ok(feet[0] <= 1 - HUMAN_BODY.capsuleRadius + 1e-6, `through the wall at ${feet[0]}`);
  assert.ok(feet[2] > 5, `no slide: z = ${feet[2]}`);
  assert.ok(Math.abs(feet[1]) < 1e-6);
});

test('a walker climbs a 0.3 m ledge but not a 0.6 m one', () => {
  const low = live(body([FLOOR(), block(1, 0, -5, 20, 0.3, 5)]), 2, EAST);
  assert.ok(Math.abs(low[1] - 0.3) < 1e-6 && low[0] > 2, `low ledge: ${low}`);
  const high = live(body([FLOOR(), block(1, 0, -5, 20, 0.6, 5)]), 2, EAST);
  assert.ok(Math.abs(high[1]) < 1e-6 && high[0] < 1, `high ledge: ${high}`);
});

test('a jump reaches v² / 2g', () => {
  const made = body([FLOOR()]);
  live(made, 0.5, STILL);
  made.pressJump();
  let apex = 0;
  for (let i = 0; i < 1200; i++) apex = Math.max(apex, made.advance(1 / 1200, STILL)[1]);
  const expected = HUMAN_BODY.jumpSpeed ** 2 / (2 * HUMAN_BODY.gravity);
  assert.ok(Math.abs(apex - expected) / expected < 0.01, `apex ${apex}, expected ${expected}`);
  assert.equal(made.onGround, true);
});

test('20 m/s never tunnels through a 0.1 m wall, even at 30 Hz', () => {
  const made = body([FLOOR(), block(2, 0, -5, 2.1, 3, 5)], 0, 0, 0, { walkSpeed: 20 });
  const feet = live(made, 1, EAST, 1 / 30);
  assert.ok(feet[0] < 2, `tunnelled to ${feet[0]}`);
});

test('released keys stop the body within its response, then it stays still', () => {
  const made = body([FLOOR()]);
  live(made, 2, EAST);
  const moving = [...made.feet];
  const stopped = live(made, 2, STILL);
  const glide = stopped[0] - moving[0];
  // An exponential brake glides v / k, k = -ln(0.05) / responseTime: 0.83 m from 4.5 m/s.
  const bound = (HUMAN_BODY.walkSpeed * HUMAN_BODY.responseTime) / -Math.log(0.05);
  assert.ok(glide > 0 && glide <= bound + 1e-3, `glide ${glide}, bound ${bound}`);
  assert.deepEqual([...made.velocity], [0, 0, 0]);
  assert.deepEqual(live(made, 1, STILL), stopped);
});

test('the motion is the same at 30 Hz and at 144 Hz', () => {
  const run = (frame: number) => {
    const made = body([FLOOR(), block(4, 0, -20, 20, 0.3, 20)], 0, 1, 0);
    live(made, 1, EAST, frame);
    made.pressJump();
    return live(made, 1, { wishX: Math.SQRT1_2, wishZ: -Math.SQRT1_2, sprint: true }, frame);
  };
  const slow = run(1 / 30),
    fast = run(1 / 144);
  const travel = Math.hypot(fast[0], fast[2]);
  const gap = Math.hypot(slow[0] - fast[0], slow[1] - fast[1], slow[2] - fast[2]);
  assert.ok(gap / travel <= 0.02, `gap ${gap} over ${travel}: ${slow} vs ${fast}`);
});
