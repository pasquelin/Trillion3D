import test from 'node:test';
import assert from 'node:assert/strict';
import type { Marker, WorldPlan } from '../plan/contract.ts';
import { box, prop, SURFACES } from '../props/index.ts';
import { EYE, FOOTING, markerProblems, markerSite } from './markers.ts';
import { solidIndex } from './solids.ts';
import { placeWorld } from './world.ts';

const world = placeWorld();

test('every teleport and spawn of the whole world stands free, on its ground or its deck', () => {
  const standing = world.markers.filter((marker) => marker.kind !== 'emitter');
  assert.ok(standing.length >= 30, `${standing.length} teleports and spawns`);
  assert.deepEqual(markerProblems(world, world.markers), []);
});

test('every walker and car stands on the floor it is drawn on, decks included, within 0.1 m', () => {
  // The drawn triangles of every solid prop, placed as the physics places its simplified ones.
  const drawn = solidIndex({
      placed: world.solids.placed,
      shapes: new Map(
        world.meshes.map(({ id, parts }) => {
          const solid = parts.filter((part) => !part.surface.name.startsWith('card/'));
          let base = 0;
          const indices = solid.flatMap((part) => {
            const shifted = [...part.indices].map((i) => i + base);
            base += part.positions.length / 3;
            return shifted;
          });
          const positions = solid.flatMap((part) => [...part.positions]);
          return [
            id,
            { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) },
          ];
        }),
      ),
    }),
    decks: string[] = [];
  for (const marker of world.markers) {
    if (marker.kind === 'emitter' || (marker.kind === 'spawn' && marker.vehicle === 'boat'))
      continue;
    const [x, y, z] = marker.position,
      feet = y - (marker.kind === 'teleport' ? EYE : 0),
      floor = drawn
        .over(x, z)
        .filter((surface) => surface.up && surface.y <= feet + FOOTING)
        .reduce((top, surface) => Math.max(top, surface.y), world.plan.height(x, z));
    assert.ok(Math.abs(feet - floor) <= 0.1, `${marker.name}: feet ${feet}, floor ${floor}`);
    if (marker.deck) decks.push(marker.name);
  }
  assert.ok(decks.includes('coast/lighthouse-gallery'), decks.join(', '));
});

/** A 20 m cube on flat ground at the origin, the only solid thing there. */
const cube = {
  plan: { height: () => 0 } as unknown as WorldPlan,
  meshes: [prop('cube', [box(SURFACES.concrete, [20, 20, 20])])],
  instances: [{ prop: 'cube', position: [0, 0, 0] as const, yaw: 0 }],
};
type Teleport = Extract<Marker, { kind: 'teleport' }>;
const at = (x: number, y: number, deck?: true): Teleport => ({
  kind: 'teleport',
  name: 'probe',
  position: [x, y, 0],
  yaw: 0,
  ...(deck ? { deck } : {}),
});

test('a teleport put in a building comes down beside it, facing it', () => {
  const { settle, problem } = markerSite(cube),
    moved = settle(at(0, 5 + EYE));
  assert.equal(problem(moved), undefined);
  assert.equal(moved.position[1], EYE);
  const [x, , z] = moved.position;
  assert.ok(Math.max(Math.abs(x), Math.abs(z)) >= 11, `at ${x}, ${z}`);
  assert.ok(Math.abs(Math.atan2(-x, -z) - moved.yaw) < 1e-9, 'faces the building');
});

test('a teleport on a declared deck stands on its top; undeclared, it is refused there', () => {
  const { settle, problem } = markerSite(cube);
  assert.match(problem(at(0, 20 + EYE)) ?? '', /ground/);
  const roof = settle(at(0, 19 + EYE, true));
  assert.deepEqual(roof.position, [0, 20 + EYE, 0]);
  assert.equal(problem(roof), undefined);
});
