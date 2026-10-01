import test from 'node:test';
import assert from 'node:assert/strict';
import { createLightingScene, type Scene, type Vec3 } from './experimentScene.ts';
import { LIGHTING_EYE } from './controls.ts';
import { validateScene } from '../transport/validation.ts';
import { cross, dot, nearestHit } from '../../../../../tests/fixtures/lightingSceneTestHelpers.ts';

const PATCH = 0.5;
/** The eye, in the right room, and its mirror image across the partition, in the left room. */
const eyes: Vec3[] = [LIGHTING_EYE, [-LIGHTING_EYE[0], LIGHTING_EYE[1], LIGHTING_EYE[2]]];
/** Evenly spread directions over the sphere (a Fibonacci lattice). */
const directions = Array.from({ length: 400 }, (_, k): Vec3 => {
  const y = 1 - (2 * (k + 0.5)) / 400,
    radius = Math.sqrt(1 - y * y),
    angle = k * Math.PI * (3 - Math.sqrt(5));
  return [radius * Math.cos(angle), y, radius * Math.sin(angle)];
});
const hit = (scene: Scene, origin: Vec3, direction: Vec3) => {
  const found = nearestHit(scene, origin, direction);
  return found && scene.surfaces[found.surface];
};

for (const doorAngle of [0, Math.PI / 2]) {
  const scene = createLightingScene({ doorAngle, lightIntensity: 1, patchSize: PATCH });
  test(`door at ${doorAngle}: rooms are valid transport scenes, each surface named for its part`, () => {
    assert.doesNotThrow(() => validateScene(scene));
    // A part's name, then its face: `west_wall_px`, never a bare `_px`.
    for (const surface of scene.surfaces) assert.match(surface.id, /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);
    assert.equal(new Set(scene.surfaces.map((surface) => surface.id)).size, scene.surfaces.length);
  });

  test(`door at ${doorAngle}: every ray from inside a room meets a face turned to it, cut into patches`, () => {
    const wrong: string[] = [];
    for (const eye of eyes)
      for (const direction of directions) {
        const surface = hit(scene, eye, direction);
        const normal = surface && cross(surface.u, surface.v);
        if (
          !surface ||
          !(dot(normal!, direction) < 0) ||
          Math.hypot(...normal!) / (surface.columns * surface.rows) > PATCH * PATCH + 1e-12
        )
          wrong.push(`${eye} ${direction} ${surface?.id}`);
      }
    assert.deepEqual(wrong, []);
  });

  test(`door at ${doorAngle}: no patch of a room face sits inside a solid wall or slab`, () => {
    const wrong: string[] = [];
    for (const patch of scene.patches) {
      const surface = scene.surfaces[patch.surface];
      if (surface.moving || surface.kind === 'mirror' || surface.columns * surface.rows === 1)
        continue;
      // A point inside a closed slab sees the back of one of the slab's faces first.
      const above = patch.center.map((value, axis) => value + 1e-4 * patch.normal[axis]) as Vec3;
      const seen = hit(scene, above, patch.normal);
      if (
        seen &&
        !seen.moving &&
        seen.kind !== 'mirror' &&
        dot(cross(seen.u, seen.v), patch.normal) > 0
      )
        wrong.push(`${surface.id} ${patch.center}`);
    }
    assert.deepEqual(wrong, []);
  });
}
