// The engine's WebGL2 particle step (#759), actually run in Chromium: the committed GLSL
// compiles, and two images of a pool ten kilometres from the world origin each move a newborn
// particle by 1 mm in half-float targets, read from the other target each time; one born dead
// and a slot nobody emitted into are left as they are. The page (`particlesStepWebglPage.ts`)
// runs the engine's own step; only it reads the state back.
//
//   node tests/browser/probes/particles-step-webgl2.ts
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dansPageWebgpu, empaquetePage } from './pageWebgpu.ts';
import type { executer } from './particlesStepWebglPage.ts';

declare global {
  var particulesWebgl: { executer: typeof executer };
}

const ici = dirname(fileURLToPath(import.meta.url));
const script = await empaquetePage(resolve(ici, 'particlesStepWebglPage.ts'), 'particulesWebgl');
const erreursPage: string[] = [];
const resultat = await dansPageWebgpu(() => globalThis.particulesWebgl.executer(), null, {
  titre: 'Trillion3D WebGL2 particles',
  script,
  erreursPage,
});
console.log(JSON.stringify(resultat, null, 2));
assert.equal(resultat.indisponible ?? null, null, String(resultat.indisponible));
assert.deepEqual([resultat.erreurs, erreursPage], [[], []]);
const [first, second] = resultat.images!;
// A half float holds 0.25 m to 2^-13 m: each 1 mm step lands within that of its place.
const within = (x: number, expected: number) => Math.abs(x - expected) <= 2 ** -13;
assert.ok(within(first[0], 0.251) && within(second[0], 0.252), `x: ${first[0]}, ${second[0]}`);
assert.ok(second[0] > first[0] && first[0] > 0.25, 'moved 1 mm each image, from the other target');
assert.ok(second[1] > first[1] && first[1] > 0, 'rose, from the emitter');
assert.deepEqual([first[3], second[3]], [1 / 64, 2 / 64], 'aged by each step');
assert.deepEqual(second.slice(8, 16), [0, 3, 0, 0, 5, 5, 5, 0], 'born dead: as staged');
assert.deepEqual(second.slice(16, 24), [0, 0, 0, 0, 0, 0, 0, 0], 'never emitted: untouched');
console.log('OK: the WebGL2 particle step actually run — see particles-step-webgl2.ts');
