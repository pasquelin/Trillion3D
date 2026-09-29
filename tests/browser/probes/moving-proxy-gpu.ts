// A moving proxy owner is traced where it is, on a real GPU (#27): the shipped traversal over the
// engine's resident proxy (`movingProxyPage.ts`). A still proxy hits its canonical plane; once
// moved, the ray over the new pose hits the moved owner — its identity, centre and albedo — and
// the shadow query agrees. On a large moved tree, the step bound the tree derives traces exactly
// what no bound traces, and the settled proxy traces the same on the still path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dansPageWebgpu, empaquetePage } from './pageWebgpu.ts';
import type { executer, executerLarge } from './movingProxyPage.ts';

declare global {
  var movingProxy: { executer: typeof executer; executerLarge: typeof executerLarge };
}

const ici = dirname(fileURLToPath(import.meta.url));
const near = (actual: number, expected: number) => Math.abs(actual - expected) < 1e-4;
/** A settled triangle is the moved one rounded once to f32: the same hit within a millimetre. */
const near3 = (actual: number, expected: number) => Math.abs(actual - expected) < 1e-3;

/** Runs one scenario of the page and checks the device raised nothing. */
async function run<R extends { indisponible?: string; erreurs?: string[] }>(scenario: () => R) {
  const script = await empaquetePage(resolve(ici, 'movingProxyPage.ts'), 'movingProxy');
  const erreursPage: string[] = [];
  const releve = await dansPageWebgpu(scenario, null, {
    titre: 'Moving proxy',
    script,
    erreursPage,
  });
  assert.equal(releve.indisponible, undefined, 'WebGPU must be available');
  assert.deepEqual([...(releve.erreurs ?? []), ...erreursPage], []);
  return releve as Exclude<Awaited<R>, { indisponible: string }>;
}

test('a moved owner is hit at its new pose by the shipped traversal, on the GPU', async () => {
  const { compilation, moved, dynamic, still, after } = await run(() =>
    globalThis.movingProxy.executer(),
  );
  assert.deepEqual(compilation, []);
  // Still: the canonical plane is hit, nothing stands five metres away.
  assert.ok(still[0].found && still[0].blocked && near(still[0].distance, 1));
  assert.ok(!still[1].found && !still[1].blocked, 'no owner stands at the future pose yet');
  assert.ok(moved && dynamic, 'the owner pose reached the resident proxy');
  // Moved: the owner left in place keeps its plane; the moved owner is hit at its new pose.
  assert.ok(after[0].found && after[0].blocked && near(after[0].distance, 1));
  assert.equal(after[0].owner, 0);
  assert.equal(after[0].red, 1, 'the resting owner reads its own white albedo');
  assert.ok(after[1].found && after[1].blocked && near(after[1].distance, 1));
  assert.equal(after[1].owner, 1, 'the ray over the new pose hits the moved owner');
  assert.equal(after[1].red, 0, 'the moved owner reads its own green albedo');
  const centre = [5 + 1 / 3, 1 / 3, 0];
  assert.ok(
    after[1].centre.every((value, axis) => near(value, centre[axis])),
    `centre ${after[1].centre} follows the moved owner`,
  );
});

test('a large moved tree traces the same with its derived bound as with none, then settled', async () => {
  const releve = await run(() => globalThis.movingProxy.executerLarge());
  const { compilation, moved, settled, dynamic, nodes, steps, bound, uncapped, built, rest } =
    releve;
  assert.deepEqual(compilation, []);
  assert.ok(moved && settled && !dynamic, 'the owners moved, then settled on the still path');
  assert.ok(steps < nodes, `bound ${steps} derived from the tree, below its ${nodes} nodes`);
  assert.ok(bound.filter((ray) => ray.found).length > 256, 'the floor and moved owners are hit');
  assert.deepEqual(bound, uncapped, 'every ray hits what an uncapped traversal hits');
  assert.ok(
    built.some((ray, index) => ray.distance !== uncapped[index].distance),
    'the tree as built bounds too few steps once moved: the scene needs the derived bound',
  );
  rest.forEach((ray, index) => {
    assert.equal(ray.found, bound[index].found, `ray ${index} after settling`);
    assert.equal(ray.blocked, bound[index].blocked, `shadow ray ${index} after settling`);
    assert.ok(near3(ray.distance, bound[index].distance), `ray ${index} distance`);
  });
});
