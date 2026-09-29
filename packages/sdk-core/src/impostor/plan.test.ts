// #1239: the runtime plan. A switched root yields a card and its clusters are suppressed, one
// decision; the switch is the engine's one CPU oracle over the baked numbers and the view, so two
// meshes of different R and T flip at different distances. Fails on develop: `plan.ts` is new.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planImpostors, impostorBakedByMesh, type ImpostorRoot } from './plan.ts';
import { impostorSwitchDepth, type ImpostorSwitchInput } from './switch.ts';
import type { ImpostorMesh, ImpostorSection } from '../contracts/impostor.ts';

const FOCAL = 1117;
const MAPS = {
  colourCoverage: { kind: 'coverage', levels: [] },
  normalDepth: { kind: 'data', levels: [] },
  orm: { kind: 'data', levels: [] },
};
/** A baked entry with its atlas: tree and bush differ in radius, root triangles and frame side. */
const bakedMesh = (
  mesh: number,
  name: string,
  input: ImpostorSwitchInput,
  hemi = false,
): ImpostorMesh => ({
  mesh,
  sourceMesh: mesh,
  name,
  placements: 40,
  masked: true,
  rootTriangles: input.rootTriangles,
  radius: input.objectRadius,
  status: 'baked',
  coverage: input.coverage,
  hemi,
  frames: 12,
  frameSide: input.frameSide,
  atlasSide: 12 * input.frameSide,
  objectRadius: input.objectRadius,
  switchDepth: { texel: 0, triangles: 0 },
  maps: MAPS,
});
const TREE = { objectRadius: 4.2, rootTriangles: 2100, coverage: 0.43, frameSide: 128 };
const BUSH = { objectRadius: 0.6, rootTriangles: 460, coverage: 0.66, frameSide: 64 };
const REFUSED: ImpostorMesh = {
  ...bakedMesh(9, 'rock', { objectRadius: 1, rootTriangles: 10, coverage: 0, frameSide: 16 }),
  status: 'refused',
  maps: undefined,
  coverage: undefined,
  reason: 'root-cheaper-than-impostor',
};
const section: ImpostorSection = {
  version: 1,
  frames: 12,
  focalPixels: FOCAL,
  textureLimit: 8192,
  baked: 2,
  refused: 1,
  meshes: [bakedMesh(1, 'tree', TREE), bakedMesh(2, 'bush', BUSH, true), REFUSED],
};

/** A column-major world: uniform scale `s`, translation `(x, y, z)`. */
const world = (x: number, y: number, z: number, s = 1): ImpostorRoot['world'] => ({
  elements: [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, x, y, z, 1],
});
const IDENTITY_VIEW = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

test('a switched root yields a card and its clusters are suppressed; a near root draws whole', () => {
  const roots: ImpostorRoot[] = [
    { mesh: 1, world: world(0, 0, -200) },
    { mesh: 2, world: world(3, 0, -10) },
    { mesh: 9, world: world(0, 0, -200) },
  ];
  const { cards, switched } = planImpostors(roots, section, IDENTITY_VIEW, FOCAL);
  assert.deepEqual([...switched], [1, 0, 0], 'only the far tree switches');
  assert.equal(cards.length, 1);
  const [card] = cards;
  assert.deepEqual(
    [card.root, card.mesh, card.radius, card.frames, card.hemi],
    [0, 1, 4.2, 12, false],
    'the card replaces the root it switched',
  );
  assert.deepEqual(card.centre, [0, 0, -200], 'the world pivot');
  assert.deepEqual(card.maps, MAPS);
});

test('the switch is the CPU oracle over the baked numbers and the view', () => {
  for (const [mesh, input] of [
    [1, TREE],
    [2, BUSH],
  ] as const) {
    const depth = impostorSwitchDepth(input, FOCAL);
    const decide = (z: number) =>
      planImpostors([{ mesh, world: world(0, 0, -z) }], section, IDENTITY_VIEW, FOCAL).switched[0];
    assert.equal(decide(depth - 1), 0, `mesh ${mesh} whole before z_s`);
    assert.equal(decide(depth + 1), 1, `mesh ${mesh} card after z_s`);
    // The boundary is a property of the mesh: no constant is shared between the two.
    assert.notEqual(depth, impostorSwitchDepth(mesh === 1 ? BUSH : TREE, FOCAL));
  }
  const depths = [TREE, BUSH].map((input) => impostorSwitchDepth(input, FOCAL));
  assert.ok(depths[0] > depths[1], 'the tree switches beyond the bush');
});

test('the largest world scale of the placement moves R and the switch with it', () => {
  const [unity, scaled] = [1, 2].map((s) =>
    planImpostors([{ mesh: 1, world: world(0, 0, -160, s) }], section, IDENTITY_VIEW, FOCAL),
  );
  assert.equal(unity.cards[0]?.radius, 4.2);
  assert.equal(scaled.cards[0]?.radius, 8.4);
  // R doubled, the switch moves out: at one depth the scaled placement is still whole where the
  // unscaled one is already a card.
  const at = (s: number) =>
    planImpostors([{ mesh: 1, world: world(0, 0, -150, s) }], section, IDENTITY_VIEW, FOCAL)
      .switched[0];
  assert.deepEqual([at(1), at(2)], [1, 0]);
});

test('a refused entry, an unknown mesh and an absent section yield no card', () => {
  const plan = planImpostors(
    [
      { mesh: 9, world: world(0, 0, -500) },
      { mesh: 77, world: world(0, 0, -500) },
      { world: world(0, 0, -500) },
    ],
    section,
    IDENTITY_VIEW,
    FOCAL,
  );
  assert.deepEqual([plan.cards.length, [...plan.switched]], [0, [0, 0, 0]]);
  assert.equal(impostorBakedByMesh(section).size, 2, 'refused entries stay out of the lookup');
  assert.deepEqual(planImpostors([], undefined, IDENTITY_VIEW, FOCAL).cards, []);
});
