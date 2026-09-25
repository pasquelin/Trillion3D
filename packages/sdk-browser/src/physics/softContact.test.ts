import test from 'node:test';
import assert from 'node:assert/strict';
import { PHYSICS_STEP } from '../../../sdk-core/src/physics/index.ts';
import { HUMAN_BODY } from '../../../sdk-core/src/collision/characterSettings.ts';
import { plane, sphere } from '../../../sdk-core/src/world/geometry/basic.ts';
import type { Geometry } from '../../../sdk-core/src/world/geometry/geometry.ts';
import type { SoftBodyOptions } from '../../../sdk-core/src/physics/index.ts';
import { createCharacterDriver } from './characterDriver.ts';
import { addBox, addSoft, flatCloth, settle, softWorld, stepBox } from './soft.fixture.ts';

/** The human character walking east from the origin for 3 s at a soft body placed at `position`
 *  and turned by `quaternion`: each step's feet, `x, z`. */
async function walkInto(
  geometry: Geometry,
  options: SoftBodyOptions,
  position: number[],
  quaternion = [0, 0, 0, 1],
) {
  const jolt = await softWorld();
  settle(jolt, addSoft(jolt, geometry, options, position, { quaternion }), 1);
  const driver = createCharacterDriver();
  jolt.step(driver.configure({ ...HUMAN_BODY }, [0, 0, 0])!, 0);
  driver.read(jolt.character(), 0);
  driver.press({ wishX: 1, wishZ: 0, sprint: false }, 0);
  const feet: [number, number][] = [];
  for (let t = 0; t < 3; t += PHYSICS_STEP) {
    jolt.step(driver.command(PHYSICS_STEP, jolt.active() > 0), PHYSICS_STEP);
    driver.read(jolt.character(), PHYSICS_STEP);
    feet.push([jolt.character()[1], jolt.character()[3]]);
  }
  return feet;
}

test('the character never walks through a soft body: a volume turns it aside, a cloth stops it', async () => {
  const reach = HUMAN_BODY.capsuleRadius;
  // A 0.5 m ball resting 2 m ahead: the capsule slides around it, never into it.
  const around = await walkInto(sphere(0.5, 16, 12), { type: 'volume' }, [2, 0.5, 0]);
  const nearest = Math.min(...around.map(([x, z]) => Math.hypot(x - 2, z)));
  assert.ok(nearest > 0.5 + reach - 0.05, `${nearest} m from the ball's centre`);
  assert.ok(around.at(-1)![0] > 3, 'it went on past the ball');
  // A 2 m curtain hung from its top row across the path, 2 m ahead: the capsule stops before it.
  const top = Array.from({ length: 21 }, (_, i) => 20 * 21 + i);
  const curtain = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
  const stopped = await walkInto(
    plane(2, 2, 20, 20),
    { type: 'cloth', pins: top },
    [2, 1.05, 0],
    curtain,
  );
  assert.ok(Math.max(...stopped.map(([x]) => x)) < 2 - reach + 0.05, 'stopped before the cloth');
});

test('a rigid body four times heavier than the cloth it lands on is held by it, not pushed through', async () => {
  // A 1 m cloth of 0.2 kg pinned at its corners, 1 m above the floor; a 0.2 m box dropped on it.
  const drop = async (mass: number) => {
    const jolt = await softWorld();
    flatCloth(jolt, 1, [0, 10, 110, 120]);
    addBox(jolt, mass, 1.5);
    let y = 1.5;
    for (let s = 0; s < 180; s++) y = stepBox(jolt, y);
    return y;
  };
  for (const mass of [0.16, 0.8, 8]) {
    const y = await drop(mass);
    assert.ok(y > 0.75, `a box of ${mass} kg rests at ${y} m, in the cloth`);
  }
});
