// #831 (GPU wave 1, C9): the impostor switch kept per root across frames. A frame reads of each
// root its pivot only, until the root is replaced or its world turns or scales; every verdict and
// every card stays the one a plan made from nothing gives, bit for bit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planImpostors, type ImpostorRoot } from './plan.ts';
import { bakedMesh } from './bakedMesh.fixture.ts';
import type { ImpostorSection } from '../contracts/impostor.ts';

const TREE = { objectRadius: 4.2, rootTriangles: 2100, coverage: 0.43, frameSide: 128 };
const BUSH = { objectRadius: 0.6, rootTriangles: 460, coverage: 0.66, frameSide: 64 };
const section: ImpostorSection = {
  version: 1,
  frames: 12,
  focalPixels: 1117,
  textureLimit: 8192,
  baked: 2,
  refused: 0,
  meshes: [bakedMesh(1, 'tree', TREE), bakedMesh(2, 'bush', BUSH, true)],
};

/** A world rotated by `angle` about y, scaled by `s`, at `(x, 0, z)`, column-major. */
const placed = (x: number, z: number, angle: number, s: number) => {
  const c = Math.cos(angle) * s,
    n = Math.sin(angle) * s;
  return [c, 0, -n, 0, 0, s, 0, 0, n, 0, c, 0, x, 0, z, 1];
};

/** Roots that count the reads of their mesh number: the lookup of a root's entry reads it. */
function forest(count: number) {
  const reads = { mesh: 0 };
  const roots = Array.from({ length: count }, (_, i) => {
    const mesh = 1 + (i % 3 === 0 ? 1 : 0);
    const root = { world: { elements: placed(i * 3 - count, -20 - i * 7, i, 1 + (i % 4) / 3) } };
    Object.defineProperty(root, 'mesh', { get: () => (reads.mesh++, mesh), enumerable: true });
    return root as ImpostorRoot;
  });
  return { roots, reads };
}

/** The view of an eye at `(x, 0, z)` looking down -z. */
const viewAt = (x: number, z: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, 0, -z, 1];

const verdict = (plan: ReturnType<typeof planImpostors>) => ({
  switched: [...plan.switched],
  cards: plan.cards.map((card) => ({ ...card, centre: [...card.centre] })),
});

test('a plan planned again in place gives the verdicts and cards of a plan made from nothing', () => {
  const { roots } = forest(120);
  let plan: ReturnType<typeof planImpostors> | undefined,
    mixed = 0;
  for (let frame = 0; frame < 40; frame++) {
    const view = viewAt(Math.sin(frame) * 30, -frame * 20);
    const focal = frame % 13 === 12 ? 700 : 1117;
    // Some roots turn, scale or move; one is replaced by another of the other mesh.
    if (frame % 5 === 4) roots[frame].world.elements = placed(0, -50 - frame, frame, 2);
    if (frame % 7 === 6) {
      const moved = Array.from(roots[frame + 1].world.elements);
      moved[12] += 5;
      roots[frame + 1].world.elements = moved;
    }
    if (frame === 20) roots[3] = { mesh: 1, world: { elements: placed(0, -400, 0, 1) } };
    plan = planImpostors(roots, section, view, focal, plan);
    assert.deepEqual(
      verdict(plan),
      verdict(planImpostors(roots, section, view, focal)),
      `frame ${frame}`,
    );
    if (plan.cards.length && plan.cards.length < roots.length) mixed++;
  }
  assert.ok(mixed > 20, 'most frames switch some roots and keep others');
});

test('a frame reads of a still root its pivot only: no entry lookup, no stretch', () => {
  const { roots, reads } = forest(300);
  const plan = planImpostors(roots, section, viewAt(0, 0), 1117);
  for (let frame = 1; frame < 4; frame++) {
    reads.mesh = 0;
    planImpostors(roots, section, viewAt(frame * 10, -frame * 40), 1117, plan);
    assert.equal(reads.mesh, 0, `frame ${frame}: no root looked up again`);
  }
});
