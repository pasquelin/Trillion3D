import test from 'node:test';
import assert from 'node:assert/strict';
import { createCharacterBody } from './characterBody.ts';
import { HUMAN_BODY } from './characterSettings.ts';
import { EAST } from './character.fixture.ts';
import { deepestAt, zUniformScenes, type WalkScene } from './characterScenes.fixture.ts';

const { capsuleRadius: radius, capsuleHeight: height } = HUMAN_BODY;

/** Walks `scene` east for two seconds, tick by tick: the deepest overlap and the farthest
 *  sideways step of any tick. */
function walk({ world, sprint }: WalkScene) {
  const body = createCharacterBody({ ...HUMAN_BODY });
  body.setWorld(world);
  body.place(0, 0, 0);
  let inside = 0,
    aside = 0;
  for (let tick = 0; tick < 240; tick++) {
    body.advance(1 / 120, { ...EAST, sprint });
    assert.ok(body.feet.every(Number.isFinite), `feet ${[...body.feet]}`);
    inside = Math.max(inside, deepestAt(world, body.feet, radius, height));
    aside = Math.max(aside, Math.abs(body.feet[2]));
  }
  return { inside, aside };
}

// Ledges, beams and tilted slabs, all uniform along z, walked straight east.
const SEED = 9,
  SCENES = 60;

test('a walker never ends a tick a centimetre inside a solid, nor drifts sideways across a scene uniform across it', () => {
  for (const scene of zUniformScenes(SEED, SCENES, radius, height)) {
    const { inside, aside } = walk(scene);
    assert.ok(inside < 0.01, `scene ${scene.index}: ${inside} m inside`);
    assert.ok(aside < 0.01, `scene ${scene.index}: ${aside} m aside`);
  }
});
